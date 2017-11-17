import * as vscode from 'vscode';
import { Position } from '../src/common/motion/position';
import { TextEditor } from '../src/textEditor';
import { VimSettings } from './vimSettings';
import { NvUtil } from './nvUtil';
import { Vim } from '../extension';
export class Cell {
  v: string;
  highlight: any;
  constructor(v: string) {
    this.v = v;
    this.highlight = {};
  }
}
interface ScreenSize {
  width: number;
  height: number;
}

export interface IgnoredKeys {
  all: string[];
  normal: string[];
  insert: string[];
  visual: string[];
}
export interface HighlightGroup {
  name: string;
  decorator?: vscode.TextEditorDecorationType;
}

export class Screen {
  OFFSET_COLOR = 1;
  term: Array<Array<Cell>> = [];
  cursX: number;
  cursY: number;
  size: ScreenSize;
  highlighter: any;
  cmdline: vscode.StatusBarItem;
  wildmenu: vscode.StatusBarItem[];
  wildmenuItems: string[];
  highlightGroups: HighlightGroup[];
  scrollRegion: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  resize(size: ScreenSize) {
    this.size = size;
    for (let i = 0; i < this.size.height; i++) {
      this.term[i] = [];
      for (let j = 0; j < this.size.width; j++) {
        this.term[i][j] = new Cell(' ');
      }
    }

    this.scrollRegion = {
      top: 0,
      bottom: this.size.height,
      left: 0,
      right: this.size.width,
    };
  }

  clear() {
    this.resize(this.size);
  }

  scroll(deltaY: number) {
    const { top, bottom, left, right } = this.scrollRegion;

    const width = right - left;
    const height = bottom - top;

    let yi = [top, bottom];
    if (deltaY < 0) {
      yi = [bottom, top - 1];
    }

    for (let y = yi[0]; y !== yi[1]; y = y + Math.sign(deltaY)) {
      if (top <= y + deltaY && y + deltaY < bottom) {
        for (let x = left; x < right; x++) {
          this.term[y][x] = this.term[y + deltaY][x];
        }
      } else {
        for (let x = left; x < right; x++) {
          this.term[y][x] = new Cell(' ');
          this.term[y][x].highlight = this.highlighter;
        }
      }
    }
  }

  constructor(size: { width: number; height: number }) {
    this.size = size;
    this.resize(this.size);

    this.cursX = 0;
    this.cursY = 0;
    this.highlighter = {};
    this.cmdline = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10001);
    this.wildmenu = [];
    for (let i = 0; i < 10; i++) {
      this.wildmenu.push(
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10000 - i)
      );
      // this.wildmenu[i].show();
    }
    // todo(chilli): Offer some way of binding these from the client side.
    this.highlightGroups = [
      {
        name: 'IncSearch',
        decorator: vscode.window.createTextEditorDecorationType({
          backgroundColor: new vscode.ThemeColor('editor.findMatchBackground'),
        }),
      },
      {
        name: 'Search',
        decorator: vscode.window.createTextEditorDecorationType({
          backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        }),
      },
      {
        name: 'multiple_cursors_visual',
        decorator: vscode.window.createTextEditorDecorationType({
          backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
        }),
      },
      {
        name: 'multiple_cursors_cursor',
        decorator: vscode.window.createTextEditorDecorationType({
          backgroundColor: new vscode.ThemeColor('editorCursor.foreground'),
        }),
      },
      {
        name: 'EasyMotionTarget',
        decorator: vscode.window.createTextEditorDecorationType({
          backgroundColor: 'black',
          textDecoration: 'none;color: red',
        }),
      },
      {
        name: 'EasyMotionShade',
        decorator: vscode.window.createTextEditorDecorationType({
          textDecoration: 'none;opacity: 0.3',
        }),
      },
    ];
    for (let i = 0; i < this.highlightGroups.length; i++) {
      Vim.nv.command(
        `highlight ${this.highlightGroups[i].name} guibg='#00000${i + this.OFFSET_COLOR}'`
      );
    }
  }
  private async handleModeChange(mode: [string, number]) {
    if (mode[0] === 'insert') {
      await NvUtil.setSettings(await VimSettings.insertModeSettings());
    } else {
      await NvUtil.updateMode();
      await NvUtil.copyTextFromNeovim();
      await NvUtil.changeSelectionFromMode(Vim.mode.mode);
      await NvUtil.setSettings(VimSettings.normalModeSettings);
    }
    // todo(chilli): Do this in a smarter way that generalizes to more categories ...
    const ignoreKeys: IgnoredKeys = vscode.workspace
      .getConfiguration('vim')
      .get('ignoreKeys') as IgnoredKeys;
    if (mode[0] === 'insert') {
      for (const key of ignoreKeys.visual.concat(ignoreKeys.normal)) {
        vscode.commands.executeCommand('setContext', `vim.use_${key}`, true);
      }
      for (const key of ignoreKeys.insert) {
        vscode.commands.executeCommand('setContext', `vim.use_${key}`, false);
      }
    } else if (mode[0] === 'visual') {
      for (const key of ignoreKeys.normal.concat(ignoreKeys.insert)) {
        vscode.commands.executeCommand('setContext', `vim.use_${key}`, true);
      }
      for (const key of ignoreKeys.visual) {
        vscode.commands.executeCommand('setContext', `vim.use_${key}`, false);
      }
    } else {
      // I assume normal is just all "other" modes.
      for (const key of ignoreKeys.visual.concat(ignoreKeys.insert)) {
        vscode.commands.executeCommand('setContext', `vim.use_${key}`, true);
      }
      for (const key of ignoreKeys.normal) {
        vscode.commands.executeCommand('setContext', `vim.use_${key}`, false);
      }
    }
    for (const key of ignoreKeys.all) {
      vscode.commands.executeCommand('setContext', `vim.use_${key}`, false);
    }
  }

  async redraw(changes: Array<any>) {
    let highlightsChanged = false;
    for (let change of changes) {
      change = change as Array<any>;
      const name = change[0];
      const args = change.slice(1);
      if (name === 'cursor_goto') {
        this.cursY = args[0][0];
        this.cursX = args[0][1];
      } else if (name === 'eol_clear') {
        for (let i = 0; i < this.size.width - this.cursX; i++) {
          this.term[this.cursY][this.cursX + i].v = ' ';
          this.term[this.cursY][this.cursX + i].highlight = {};
        }
        highlightsChanged = true;
      } else if (name === 'put') {
        for (const cs of args) {
          for (const c of cs) {
            this.term[this.cursY][this.cursX].v = c;
            this.term[this.cursY][this.cursX].highlight = this.highlighter;
            this.cursX += 1;
          }
        }
        highlightsChanged = true;
      } else if (name === 'highlight_set') {
        this.highlighter = args[args.length - 1][0];
      } else if (name === 'mode_change') {
        this.handleModeChange(args[0]);
      } else if (name === 'set_scroll_region') {
        this.scrollRegion = {
          top: args[0][0],
          bottom: args[0][1] + 1,
          left: args[0][2],
          right: args[0][3] + 1,
        };
      } else if (name === 'resize') {
        this.resize({ width: args[0][0], height: args[0][1] });
      } else if (name === 'scroll') {
        this.scroll(args[0][0]);
      } else if (name === 'cmdline_show') {
        let text = '';
        for (let hlText of args[0][0]) {
          text += hlText[1];
        }
        this.cmdline.text =
          args[0][2] +
          args[0][3] +
          ' '.repeat(args[0][4]) +
          text.slice(0, args[0][1]) +
          '|' +
          text.slice(args[0][1]);
        this.cmdline.text += ' '.repeat(30 - this.cmdline.text.length % 30);
        this.cmdline.show();
      } else if (name === 'cmdline_hide') {
        this.cmdline.hide();
      } else if (
        [
          'cmdline_pos',
          'cmdline_special_char',
          'cmdline_block_show',
          'cmdline_block_append',
          'cmdline_block_hide',
        ].indexOf(name) !== -1
      ) {
        // console.log(name);
        // console.log(args);
      } else if (name === 'wildmenu_show') {
        this.wildmenuItems = args[0][0];
      } else if (name === 'wildmenu_hide') {
        for (const i of this.wildmenu) {
          i.hide();
        }
      } else if (name === 'wildmenu_select') {
        // There's logic in here to "batch" wildmenu items into groups of 5 each.
        const selectIndex = args[0][0];
        const NUM_ITEMS_TO_SHOW = 5;
        const startIndex = selectIndex - selectIndex % NUM_ITEMS_TO_SHOW;
        const endIndex = selectIndex + 5 - selectIndex % NUM_ITEMS_TO_SHOW;
        let offset = startIndex > 0 ? 1 : 0;
        if (offset) {
          this.wildmenu[0].text = '<';
        }
        for (let i = 0; i < NUM_ITEMS_TO_SHOW; i++) {
          this.wildmenu[i + offset].text = this.wildmenuItems[startIndex + i];
          if (startIndex + i === selectIndex) {
            this.wildmenu[i + offset].color = new vscode.ThemeColor(
              'statusBarItem.prominentBackground'
            );
          } else {
            this.wildmenu[i + offset].color = undefined;
          }
          this.wildmenu[i + offset].show();
        }
        if (endIndex < this.wildmenuItems.length - 1) {
          this.wildmenu[offset + NUM_ITEMS_TO_SHOW].text = '>';
          this.wildmenu[offset + NUM_ITEMS_TO_SHOW].show();
        }
        for (let i = offset + NUM_ITEMS_TO_SHOW + 1; i < this.wildmenu.length; i++) {
          this.wildmenu[i].hide();
        }
      } else {
        // console.log(name);
        // console.log(args);
      }
    }

    // If nvim is connected to a TUI, then we can't get external ui for cmdline/wildmenu.
    if (Vim.DEBUG) {
      this.cmdline.text = this.term[this.size.height - 1].map(x => x.v).join('');
      this.cmdline.show();
      const wildmenuText = this.term[this.size.height - 2]
        .map(x => x.v)
        .join('')
        .replace(/\s+$/, '');
      let wildmenu: string[] = wildmenuText.split(/\s+/);
      // Doesn't always work, who cares??? What a pain in the ass. I don't want to not use regex.
      let wildmenuIdx = wildmenu.map(x => wildmenuText.indexOf(x));
      if (wildmenu[0] === '<' || wildmenu[wildmenu.length - 1] === '>') {
        for (let i = 0; i < wildmenu.length; i++) {
          this.wildmenu[i].text = wildmenu[i];
          this.wildmenu[i].show();
          if (
            this.term[this.size.height - 2][wildmenuIdx[i]].highlight.hasOwnProperty('foreground')
          ) {
            this.wildmenu[i].color = 'red';
          } else {
            this.wildmenu[i].color = 'white';
          }
        }
        for (let i = wildmenu.length; i < this.wildmenu.length; i++) {
          this.wildmenu[i].hide();
        }
      } else {
        for (let i = 0; i < this.wildmenu.length; i++) {
          this.wildmenu[i].hide();
        }
      }
    }

    if (!vscode.workspace.getConfiguration('vim').get('enableHighlights') || !highlightsChanged) {
      return;
    }
    let curPos = await NvUtil.getCursorPos();
    let yOffset = curPos.line - ((await Vim.nv.call('winline')) - 1);
    let xOffset = curPos.character - ((await Vim.nv.call('wincol')) - 1);
    let hlDecorations: vscode.Range[][] = [];
    for (let i = 0; i < this.highlightGroups.length; i++) {
      hlDecorations.push([]);
    }
    let curVimColor = -1;
    for (let i = 0; i < this.size.height; i++) {
      let isRange = false;
      let start = 0;
      for (let j = 0; j < this.size.width; j++) {
        if (isRange && !(this.term[i][j].highlight.background === curVimColor)) {
          isRange = false;
          hlDecorations[curVimColor - this.OFFSET_COLOR].push(
            new vscode.Range(
              new vscode.Position(i + yOffset, start + xOffset),
              new vscode.Position(i + yOffset, j + xOffset)
            )
          );
          curVimColor = -1;
        }
        const cellColor = this.term[i][j].highlight.background - this.OFFSET_COLOR;
        if (!isRange && cellColor >= 0 && cellColor < hlDecorations.length) {
          start = j;
          isRange = true;
          curVimColor = this.term[i][j].highlight.background;
        }
      }
    }
    for (let i = 0; i < hlDecorations.length; i++) {
      if (!(this.highlightGroups[i].decorator && vscode.window.activeTextEditor)) {
        continue;
      }
      vscode.window.activeTextEditor!.setDecorations(
        this.highlightGroups[i].decorator!,
        hlDecorations[i]
      );
    }
  }
}
