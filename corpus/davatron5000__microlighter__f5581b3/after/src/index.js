import { highlight } from "./highlight.js";
import { languageFor, loadGrammars } from "./highlight-all.js";

/**
 * Scan the DOM for code blocks, lazily load the grammars they need, and
 * register CSS Custom Highlight ranges. Side effects happen only when called.
 *
 * @param {Object} [options]
 * @param {ParentNode} [options.root=document] Root to query within.
 * @param {string} [options.selector] Code block selector.
 * @param {Object<string, string>} [options.languageAliases] Custom aliases
 * mapping code block language names to shipped grammar names.
 * @returns {Promise<HTMLElement[]>} The highlighted code elements.
 */
export const highlightAll = async ({
  root = document,
  selector = "pre > code",
  languageAliases
} = {}) => {
  const language = code => {
    const requested = languageFor(code);
    return languageAliases?.[requested] || requested;
  };
  const codeBlocks = [...root.querySelectorAll(selector)].filter(language);
  const languages = [...new Set(codeBlocks.map(language))]
    .filter(language => /^[a-z0-9_-]+$/.test(language));
  const grammars = await loadGrammars(languages);

  highlight(codeBlocks, code => grammars.byLanguage[language(code)], grammars.byScope);
  return codeBlocks;
};
