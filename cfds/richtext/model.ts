import {
  type ElementNode,
  isTextNode,
  type RichTextValue,
  type TextNode,
} from './tree.ts';
import type { WritingDirection } from '../../base/string.ts';

export type MarkupElement =
  | ParagraphNode
  | Header1Node
  | Header2Node
  | Header3Node
  | Header4Node
  | Header5Node
  | Header6Node
  | UnorderedListNode
  | OrderedListNode
  | ListItemNode;
export type MarkupNode = MarkupElement | TextNode;
// | TableNode
// | TableRowNode
// | TableCellNode
// | SpanNode
// | ObjectNode
// | HyperlinkNode
// | ImageNode
// | MentionElement;

export const STICKY_ELEMENT_TAGS = ['li'] as readonly (string | undefined)[];

export interface NodeWithDirection {
  dir?: WritingDirection;
}

export interface ParagraphNode extends ElementNode, NodeWithDirection {
  readonly tagName: 'p';
}

export interface Header1Node extends ElementNode, NodeWithDirection {
  readonly tagName: 'h1';
}

export interface Header2Node extends ElementNode, NodeWithDirection {
  readonly tagName: 'h2';
}

export interface Header3Node extends ElementNode, NodeWithDirection {
  readonly tagName: 'h3';
}

export interface Header4Node extends ElementNode, NodeWithDirection {
  readonly tagName: 'h4';
}

export interface Header5Node extends ElementNode, NodeWithDirection {
  readonly tagName: 'h5';
}

export interface Header6Node extends ElementNode, NodeWithDirection {
  readonly tagName: 'h6';
}

export interface UnorderedListNode extends ElementNode, NodeWithDirection {
  readonly tagName: 'ul';
}

export interface OrderedListNode extends ElementNode, NodeWithDirection {
  readonly tagName: 'ol';
  start?: number;
}

export interface ListItemNode extends ElementNode, NodeWithDirection {
  readonly tagName: 'li';
}

export interface TableNode extends ElementNode {
  readonly tagName: 'table';
}

export interface TableRowNode extends ElementNode {
  readonly tagName: 'tr';
}

export interface TableCellNode extends ElementNode {
  readonly tagName: 'td';
}

export interface SpanNode extends TextNode {
  readonly tagName: 'span';
  bold?: boolean;
  underline?: boolean;
  strike?: boolean;
  italic?: boolean;
}

export function isSpanNode(atom: CoreValue): atom is SpanNode {
  return isTextNode(atom) && atom.tagName === 'span';
}

export interface HyperlinkNode extends TextNode {
  readonly tagName: 'a';
  href: string;
}

export interface ObjectNode extends RichTextValue {
  readonly tagName: 'object';
}

export interface ImageNode extends RichTextValue {
  readonly tagName: 'img';
  src: string;
}

export interface InlineTaskNode extends ElementNode {
  readonly tagName: 'inline-task';
  assignees?: Set<string>;
  // attachments?: Set<AttachmentData>;
  tags?: Set<string>;
  dueDate?: Date;
  status?: number;
}

export interface MentionElement extends ElementNode {
  tagName: 'mention';
  pluginId: string;
  isLocal: true;
}
