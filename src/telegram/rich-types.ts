/**
 * Rich message types for Telegram Bot API 10.1+.
 * Re-exports and complements types from grammy/types.
 */

import type {
  InputRichMessage as GrammyInputRichMessage,
  InputRichBlock as GrammyInputRichBlock,
  InputRichBlockTable as GrammyInputRichBlockTable,
  RichBlockTableCell as GrammyRichBlockTableCell,
  InputRichBlockParagraph as GrammyInputRichBlockParagraph,
  InputRichBlockSectionHeading as GrammyInputRichBlockSectionHeading,
  InputRichBlockPreformatted as GrammyInputRichBlockPreformatted,
  InputRichBlockList as GrammyInputRichBlockList,
  InputRichBlockListItem as GrammyInputRichBlockListItem,
  InputRichBlockBlockQuotation as GrammyInputRichBlockBlockQuotation,
  InputRichBlockExpandableBlockQuotation as GrammyInputRichBlockExpandableBlockQuotation,
  InputRichBlockDetails as GrammyInputRichBlockDetails,
  InputRichBlockDivider as GrammyInputRichBlockDivider,
  InputRichBlockThinking as GrammyInputRichBlockThinking,
  RichText as GrammyRichText,
  RichTextBold as GrammyRichTextBold,
  RichTextItalic as GrammyRichTextItalic,
  RichTextUnderline as GrammyRichTextUnderline,
  RichTextStrikethrough as GrammyRichTextStrikethrough,
  RichTextSpoiler as GrammyRichTextSpoiler,
  RichTextCode as GrammyRichTextCode,
  RichTextUrl as GrammyRichTextUrl,
  RichTextMathematicalExpression as GrammyRichTextMathematicalExpression,
  RichTextCustomEmoji as GrammyRichTextCustomEmoji,
  RichBlockCaption as GrammyRichBlockCaption,
} from "grammy/types";

export type InputRichMessage = GrammyInputRichMessage;
export type InputRichBlock = GrammyInputRichBlock;
export type InputRichBlockTable = GrammyInputRichBlockTable;
export type RichBlockTableCell = GrammyRichBlockTableCell;
export type InputRichBlockParagraph = GrammyInputRichBlockParagraph;
export type InputRichBlockSectionHeading = GrammyInputRichBlockSectionHeading;
export type InputRichBlockPreformatted = GrammyInputRichBlockPreformatted;
export type InputRichBlockList = GrammyInputRichBlockList;
export type InputRichBlockListItem = GrammyInputRichBlockListItem;
export type InputRichBlockBlockQuotation = GrammyInputRichBlockBlockQuotation;
export type InputRichBlockExpandableBlockQuotation = GrammyInputRichBlockExpandableBlockQuotation;
export type InputRichBlockDetails = GrammyInputRichBlockDetails;
export type InputRichBlockDivider = GrammyInputRichBlockDivider;
export type InputRichBlockThinking = GrammyInputRichBlockThinking;

export type RichText = GrammyRichText;
export type RichTextBold = GrammyRichTextBold;
export type RichTextItalic = GrammyRichTextItalic;
export type RichTextUnderline = GrammyRichTextUnderline;
export type RichTextStrikethrough = GrammyRichTextStrikethrough;
export type RichTextSpoiler = GrammyRichTextSpoiler;
export type RichTextCode = GrammyRichTextCode;
export type RichTextUrl = GrammyRichTextUrl;
export type RichTextMathematicalExpression = GrammyRichTextMathematicalExpression;
export type RichTextCustomEmoji = GrammyRichTextCustomEmoji;
export type RichBlockCaption = GrammyRichBlockCaption;

/**
 * Structured entity node within RichText (excluding primitive string and recursive array).
 */
export type RichTextEntity = Exclude<RichText, string | RichText[]>;
