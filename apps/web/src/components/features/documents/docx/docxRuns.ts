/**
 * The runs of one part of a DOCX and what surrounds them, for the writer (spec 2026-10-31-document-hyperlinks-design.md
 * §6.3, §6.5). Pure: one walk over the tokens of `xmlTokens.ts`, recording where every `w:r` and its children lie in
 * the source, so the writer can splice the original text (§6.2) and can tell which citations it must leave alone.
 *
 * Offsets are UTF-16 indexes into the part's XML as decoded, the same as the reader's map (`docxText.ts`).
 */
import { tokenize, type XmlAttribute } from './xmlTokens';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const DEFAULT_PREFIXES: Record<string, string> = { w: W_NS, mc: MC_NS };

/** A child of a run other than its properties: a `w:t`, a tab, a field character, a drawing… */
export interface RunAtom {
  ns: string;
  local: string;
  start: number;
  end: number;
  /** For `w:sym`: the character it stands for, as the reader reads it. */
  symChar?: string;
  /** For a `w:t`. */
  text?: {
    /** The element's name as written (`w:t`). */
    name: string;
    /** Where its open tag ends (its content starts) and its close tag starts. */
    openEnd: number;
    closeStart: number;
    /** The content as the reader reads it (each text token decoded, joined). */
    decoded: string;
    /** One plain text token, no CDATA and no comment: only such a `w:t` can be cut in two. */
    plain: boolean;
    /** `xml:space="preserve"` on it; `otherSpace` for any other value of `xml:space`. */
    preserve: boolean;
    otherSpace: boolean;
  };
}

export interface RunProperties {
  name: string;
  start: number;
  end: number;
  selfClosing: boolean;
  /** Its direct children, in order. */
  children: Array<{ ns: string; local: string; start: number; end: number }>;
}

/** Where a run sits: the wrappers around it that make the writer leave a citation alone (§6.5). */
export interface RunContext {
  /** A `w:hyperlink` around it, or a `w:fldSimple` whose instruction is `HYPERLINK`. */
  hyperlink: boolean;
  /** A `w:fldSimple` (any other instruction). */
  simpleField: boolean;
  /** `w:ins`, `w:del`, `w:moveTo`, `w:moveFrom` around it. */
  revision: boolean;
  /** A content control (`w:sdt`) around it or around its paragraph. */
  contentControl: boolean;
  /** A text box (`w:txbxContent`), a `w:smartTag` or `w:customXml` wrapper, or a fallback copy (`mc:Fallback`). */
  structure: boolean;
}

export interface RunInfo {
  /** Its place among the part's runs, in document order. */
  index: number;
  name: string;
  /** The prefix it is written with: the writer writes its own elements with the same one. */
  prefix: string;
  ns: string;
  local: string;
  start: number;
  /** Where its open tag ends, where its close tag starts, where it ends. Equal for a self-closed run. */
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  /** Its open tag declares a namespace (no producer does: the writer leaves such a run alone). */
  declaresNamespace: boolean;
  rPr?: RunProperties;
  atoms: RunAtom[];
  /** Its parent element, and the paragraph it belongs to (`-1`: none). */
  parent: { ns: string; local: string; start: number };
  paragraphStart: number;
  context: RunContext;
  /** A complex field open where the run starts: `link` when it is a `HYPERLINK` field. */
  field: 'link' | 'field' | null;
  /** The run holds a field character or a field's instruction. */
  fieldPart: boolean;
  /** Its properties carry a tracked change (`w:rPrChange`). */
  formatRevision: boolean;
  /** Its properties hide it (`w:vanish`). */
  hidden: boolean;
  /** Its properties name a character style (`w:rStyle`), set a colour, an underline. */
  hasStyle: boolean;
  hasColor: boolean;
  hasUnderline: boolean;
  /** A prefix bound to the relationships namespace where the run is, and whether `r` is bound to another one. */
  relPrefix: string | null;
  rPrefixTaken: boolean;
}

/** A direct child of a paragraph: a run or anything else (a bookmark, a comment's edge, a revision, a link…). */
export interface ParagraphChild {
  ns: string;
  local: string;
  start: number;
  end: number;
  /** The run's index, when the child is a run. */
  run?: number;
}

export interface PartRuns {
  runs: RunInfo[];
  /** By where the run's tag starts (the reader's `runStart`). */
  runByStart: Map<number, RunInfo>;
  /** Each paragraph's direct children, by where the paragraph starts. */
  paragraphs: Map<number, ParagraphChild[]>;
}

function attribute(attributes: XmlAttribute[], local: string): string | undefined {
  for (const { name, value } of attributes) {
    if (name === local || name.endsWith(`:${local}`)) return value;
  }
  return undefined;
}

function isOn(value: string | undefined): boolean {
  return value === undefined || !['false', '0', 'off'].includes(value);
}

const HYPERLINK_INSTRUCTION = /^\s*HYPERLINK\b/i;

interface Frame {
  ns: string;
  local: string;
  start: number;
  declared: string[] | null;
  run?: RunInfo;
  rPr?: RunProperties;
  atom?: RunAtom;
  textPieces?: string[];
  child?: ParagraphChild;
  paragraph?: ParagraphChild[];
  counters: Array<keyof Counters>;
  instruction?: boolean;
}

interface Counters {
  hyperlink: number;
  simpleField: number;
  revision: number;
  contentControl: number;
  structure: number;
  fallback: number;
}

/** Walks `xml` once and returns its runs, with their children and context, and each paragraph's children. */
export function partRuns(xml: string): PartRuns {
  const runs: RunInfo[] = [];
  const runByStart = new Map<number, RunInfo>();
  const paragraphs = new Map<number, ParagraphChild[]>();
  const bindings = new Map<string, string[]>(Object.entries(DEFAULT_PREFIXES).map(([prefix, uri]) => [prefix, [uri]]));
  const resolve = (prefix: string) => {
    const stack = bindings.get(prefix);
    return stack && stack.length > 0 ? stack[stack.length - 1] : '';
  };
  const stack: Frame[] = [];
  const counters: Counters = { hyperlink: 0, simpleField: 0, revision: 0, contentControl: 0, structure: 0, fallback: 0 };
  /** Complex fields open, innermost last. */
  const fields: Array<{ instruction: string; phase: 'instruction' | 'result' }> = [];

  const nearestParagraph = (): number => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].ns === W_NS && stack[index].local === 'p') return stack[index].start;
    }
    return -1;
  };
  const relBinding = (): { relPrefix: string | null; rPrefixTaken: boolean } => {
    let relPrefix: string | null = null;
    for (const [prefix, uris] of bindings) {
      if (prefix && uris.length > 0 && uris[uris.length - 1] === REL_NS) {
        relPrefix = prefix;
        break;
      }
    }
    const r = resolve('r');
    return { relPrefix, rPrefixTaken: r !== '' && r !== REL_NS };
  };

  for (const token of tokenize(xml)) {
    const top = stack[stack.length - 1];
    if (token.type === 'text') {
      if (top?.textPieces) top.textPieces.push(token.text);
      if (top?.instruction && counters.fallback === 0) {
        const field = fields[fields.length - 1];
        if (field?.phase === 'instruction') field.instruction += token.text;
      }
      continue;
    }

    if (token.type === 'close') {
      const frame = stack.pop();
      if (!frame) continue;
      closeFrame(frame, token.start, token.end);
      continue;
    }

    // An open tag.
    let declared: string[] | null = null;
    for (const { name, value } of token.attributes) {
      if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
      const prefix = name === 'xmlns' ? '' : name.slice(6);
      const list = bindings.get(prefix);
      if (list) list.push(value);
      else bindings.set(prefix, [value]);
      (declared ??= []).push(prefix);
    }
    const colon = token.name.indexOf(':');
    const prefix = colon < 0 ? '' : token.name.slice(0, colon);
    const local = colon < 0 ? token.name : token.name.slice(colon + 1);
    const ns = resolve(prefix);
    const frame: Frame = { ns, local, start: token.start, declared, counters: [] };
    const isW = ns === W_NS;

    // A direct child of a paragraph.
    if (top?.paragraph) {
      frame.child = { ns, local, start: token.start, end: token.end };
      top.paragraph.push(frame.child);
    }
    if (isW && local === 'p') {
      frame.paragraph = [];
      paragraphs.set(token.start, frame.paragraph);
    }

    // The run's own children.
    const parentRun = top?.run;
    if (parentRun && !token.selfClosing && isW && local === 'rPr') {
      frame.rPr = { name: token.name, start: token.start, end: token.end, selfClosing: false, children: [] };
      parentRun.rPr = frame.rPr;
    } else if (parentRun && isW && local === 'rPr') {
      parentRun.rPr = { name: token.name, start: token.start, end: token.end, selfClosing: true, children: [] };
    } else if (parentRun) {
      const atom: RunAtom = { ns, local, start: token.start, end: token.end };
      if (isW && local === 'sym') {
        const code = attribute(token.attributes, 'char');
        const value = code && /^[0-9a-fA-F]{1,6}$/.test(code) ? parseInt(code, 16) : NaN;
        if (value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)) atom.symChar = String.fromCodePoint(value);
      }
      if (isW && local === 't') {
        const space = token.attributes.find(attr => attr.name === 'xml:space')?.value;
        atom.text = {
          name: token.name, openEnd: token.end, closeStart: token.end, decoded: '', plain: true,
          preserve: space === 'preserve', otherSpace: space !== undefined && space !== 'preserve',
        };
        if (!token.selfClosing) frame.textPieces = [];
      }
      if (isW && (local === 'fldChar' || local === 'instrText' || local === 'delInstrText')) parentRun.fieldPart = true;
      parentRun.atoms.push(atom);
      frame.atom = atom;
    }

    // The children of a run's properties.
    if (top?.rPr) top.rPr.children.push({ ns, local, start: token.start, end: token.end });
    if (top?.rPr && isW) {
      const run = stack[stack.length - 2]?.run;
      if (run) {
        if (local === 'rPrChange') run.formatRevision = true;
        if (local === 'vanish' && isOn(attribute(token.attributes, 'val'))) run.hidden = true;
        if (local === 'rStyle') run.hasStyle = true;
        if (local === 'color') run.hasColor = true;
        if (local === 'u') run.hasUnderline = true;
      }
    }

    // A complex field's characters and instruction (outside a fallback copy, which repeats its choice).
    if (isW && local === 'fldChar' && parentRun && counters.fallback === 0) {
      const type = attribute(token.attributes, 'fldCharType');
      if (type === 'begin') fields.push({ instruction: '', phase: 'instruction' });
      else if (type === 'separate' && fields.length > 0) fields[fields.length - 1].phase = 'result';
      else if (type === 'end') fields.pop();
    }
    if (isW && (local === 'instrText' || local === 'delInstrText')) frame.instruction = true;

    // A run.
    if (isW && local === 'r') {
      const field = fields.length === 0
        ? null
        : fields.some(open => open.phase === 'result' && HYPERLINK_INSTRUCTION.test(open.instruction)) ? 'link' : 'field';
      const run: RunInfo = {
        index: runs.length,
        name: token.name, prefix, ns, local,
        start: token.start, openEnd: token.end, closeStart: token.end, end: token.end,
        selfClosing: token.selfClosing,
        declaresNamespace: declared !== null,
        atoms: [],
        parent: top ? { ns: top.ns, local: top.local, start: top.start } : { ns: '', local: '', start: -1 },
        paragraphStart: nearestParagraph(),
        context: {
          hyperlink: counters.hyperlink > 0,
          simpleField: counters.simpleField > 0,
          revision: counters.revision > 0,
          contentControl: counters.contentControl > 0,
          structure: counters.structure > 0 || counters.fallback > 0,
        },
        field,
        fieldPart: false, formatRevision: false, hidden: false, hasStyle: false, hasColor: false, hasUnderline: false,
        ...relBinding(),
      };
      runs.push(run);
      runByStart.set(token.start, run);
      if (frame.child) frame.child.run = run.index;
      frame.run = run;
    } else if (ns !== W_NS || local !== 'r') {
      // Wrappers (any element that is not a run): what the runs inside them must know.
      const wrapper: keyof Counters | null = !isW
        ? (ns === MC_NS && local === 'Fallback' ? 'fallback' : null)
        : local === 'hyperlink' ? 'hyperlink'
          : local === 'fldSimple' ? (HYPERLINK_INSTRUCTION.test(attribute(token.attributes, 'instr') ?? '') ? 'hyperlink' : 'simpleField')
            : ['ins', 'del', 'moveTo', 'moveFrom'].includes(local) ? 'revision'
              : local === 'sdt' ? 'contentControl'
                : ['txbxContent', 'smartTag', 'customXml'].includes(local) ? 'structure'
                  : null;
      if (wrapper && !token.selfClosing) {
        counters[wrapper] += 1;
        frame.counters.push(wrapper);
      }
    }

    if (token.selfClosing) {
      closeFrame(frame, token.start, token.end, true);
      continue;
    }
    stack.push(frame);
  }

  function closeFrame(frame: Frame, closeStart: number, closeEnd: number, selfClosed = false): void {
    if (frame.child) frame.child.end = closeEnd;
    if (frame.run && !selfClosed) {
      frame.run.closeStart = closeStart;
      frame.run.end = closeEnd;
    }
    if (frame.rPr) frame.rPr.end = closeEnd;
    if (frame.atom) {
      frame.atom.end = closeEnd;
      if (frame.atom.text && !selfClosed) {
        frame.atom.text.closeStart = closeStart;
        frame.atom.text.decoded = (frame.textPieces ?? []).join('');
        frame.atom.text.plain = !xml.slice(frame.atom.text.openEnd, closeStart).includes('<');
      }
    }
    // A run-properties child closes: its end is the close tag's.
    const parent = stack[stack.length - 1];
    if (parent?.rPr && !selfClosed) {
      const child = parent.rPr.children[parent.rPr.children.length - 1];
      if (child && child.start === frame.start) child.end = closeEnd;
    }
    for (const counter of frame.counters) counters[counter] -= 1;
    for (const prefix of frame.declared ?? []) bindings.get(prefix)?.pop();
  }

  return { runs, runByStart, paragraphs };
}
