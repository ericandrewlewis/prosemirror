import {SchemaSpec, Schema, Block, Textblock, Inline, Text, Attribute, MarkType, NodeKind} from "../../dist/model/schema"
import {Doc, BlockQuote, OrderedList, BulletList, ListItem, HorizontalRule, Paragraph, Heading, CodeBlock, Image, HardBreak, EmMark, StrongMark, LinkMark, CodeMark} from "../../dist/model/defaultschema"

import {ImageFromAnAPI} from "../lockednode"
// :: SchemaSpec
// The specification for the default schema.
const spec = new SchemaSpec({
  doc: Doc,
  blockquote: BlockQuote,
  ordered_list: OrderedList,
  bullet_list: BulletList,
  list_item: ListItem,
  horizontal_rule: HorizontalRule,

  paragraph: Paragraph,
  heading: Heading,
  code_block: CodeBlock,

  text: Text,
  image: Image,
  hard_break: HardBreak,
  image_from_an_api: ImageFromAnAPI
}, {
  em: EmMark,
  strong: StrongMark,
  link: LinkMark,
  code: CodeMark
})

// :: Schema
// ProseMirror's default document schema.
export const schema = new Schema(spec)
