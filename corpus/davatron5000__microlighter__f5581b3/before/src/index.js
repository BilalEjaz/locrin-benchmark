import { highlight } from "./highlight.js";
import { createGrammarLoader, normalizeLanguage } from "./grammar-dependencies.js";

const languageClassFor = element => [...element.classList]
  .find(className => className.startsWith("language-"))
  ?.slice("language-".length);

/**
 * Read and normalize the language declared by a code block.
 * @param {HTMLElement} code
 * @returns {string}
 */
const languageFor = code => {
  const pre = code.parentElement;
  const language = languageClassFor(code)
    || code.dataset.language
    || languageClassFor(pre)
    || pre.dataset.language
    // Deprecated: `lang` describes human language, not programming language.
    || pre.getAttribute("lang")
    || "";

  return normalizeLanguage(language.toLowerCase());
};
const loadGrammars = createGrammarLoader();

/**
 * Scan the DOM for code blocks, lazily load the grammars they need, and
 * register CSS Custom Highlight ranges. Side effects happen only when called.
 *
 * @param {Object} [options]
 * @param {ParentNode} [options.root=document] Root to query within.
 * @param {string} [options.selector] Code block selector.
 * @returns {Promise<HTMLElement[]>} The highlighted code elements.
 */
export const highlightAll = async ({ root = document, selector = "pre > code" } = {}) => {
  const codeBlocks = [...root.querySelectorAll(selector)].filter(languageFor);
  const languages = [...new Set(codeBlocks.map(languageFor))]
    .filter(language => /^[a-z0-9_-]+$/.test(language));
  const grammars = await loadGrammars(languages);

  highlight(codeBlocks, code => grammars.byLanguage[languageFor(code)], grammars.byScope);
  return codeBlocks;
};
