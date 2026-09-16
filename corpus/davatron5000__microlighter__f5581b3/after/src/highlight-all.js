import { highlight } from "./highlight.js";
import { createGrammarLoader } from "./grammar-dependencies.js";

const languageClassFor = element => [...element.classList]
  .find(className => className.startsWith("language-"))
  ?.slice("language-".length);

export const languageFor = code => {
  const pre = code.parentElement;
  const language = languageClassFor(code)
    || code.dataset.language
    || languageClassFor(pre)
    || pre.dataset.language
    // Deprecated: `lang` describes human language, not programming language.
    || pre.getAttribute("lang")
    || "";

  return language.toLowerCase();
};
export const loadGrammars = createGrammarLoader();

export const highlightAll = async ({ root = document, selector = "pre > code" } = {}) => {
  const codeBlocks = [...root.querySelectorAll(selector)].filter(languageFor);
  const languages = [...new Set(codeBlocks.map(languageFor))]
    .filter(language => /^[a-z0-9_-]+$/.test(language));
  const grammars = await loadGrammars(languages);

  highlight(codeBlocks, code => grammars.byLanguage[languageFor(code)], grammars.byScope);
  return codeBlocks;
};
