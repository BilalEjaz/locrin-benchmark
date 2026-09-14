/**
 * Convert a supported language alias to its grammar module name.
 * @param {string} language
 * @param {Object<string, string>} aliases
 * @returns {string}
 */
export const normalizeLanguage = (language, aliases) => aliases[language] || language;

/**
 * Find grammar modules referenced by external TextMate scope includes.
 * Local repository references (`#...`, `$self`, and `$base`) are ignored.
 * @param {*} value Grammar or nested grammar rule to inspect.
 * @returns {Set<string>} Normalized grammar module names.
 */
export const externalLanguagesFor = value => {
  const languages = new Set();

  const visit = item => {
    if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (item && typeof item === "object") {
      if (typeof item.include === "string" && !/^[#$]/.test(item.include)) {
        const scope = item.include.split("#")[0];
        const match = scope.match(/^(?:source|text)\.([a-z0-9_-]+)/);
        if (match) languages.add(match[1]);
      }
      Object.values(item).forEach(visit);
    }
  };

  visit(value);
  return languages;
};

/**
 * Dynamically import a shipped grammar.
 * @param {string} language
 * @returns {Promise<Object | null>}
 */
const grammarFor = language => import(`./grammars/${language}.js`)
  .then(module => module.default)
  .catch(() => null);

/**
 * Create a cached loader that also resolves external grammar dependencies.
 * @param {(language: string) => Promise<Object | null>} [importLanguage]
 * @returns {(languages: string[]) => Promise<{
 *   byLanguage: Object<string, Object>,
 *   byScope: Map<string, Object>
 * }>}
 */
export const createGrammarLoader = (importLanguage = grammarFor) => {
  const grammarModules = new Map();
  const grammars = {
    byLanguage: {},
    byScope: new Map()
  };
  let aliasesModule;

  const normalizeLanguages = async languages => {
    aliasesModule ||= import(`./${"language-aliases"}.js`);
    const { default: aliases } = await aliasesModule;
    return [...new Set(languages)].map(requested => ({
      requested,
      canonical: normalizeLanguage(requested, aliases)
    })).filter(({ canonical }) => /^[a-z0-9_-]+$/.test(canonical));
  };
  /**
   * Import and index a grammar once for the lifetime of this loader.
   * @param {string} language
   * @returns {Promise<Object | null>}
   */
  const loadGrammar = language => {
    if (!grammarModules.has(language)) {
      const grammarModule = importLanguage(language).then(grammar => {
        if (grammar) {
          grammars.byLanguage[language] = grammar;
          grammars.byScope.set(grammar.scopeName, grammar);
        }
        return grammar;
      });
      grammarModules.set(language, grammarModule);
    }

    return grammarModules.get(language);
  };

  return async languages => {
    const requestedLanguages = await normalizeLanguages(languages);
    let pendingLanguages = requestedLanguages
      .map(({ canonical }) => canonical)
      .filter(language => !grammarModules.has(language));

    while (pendingLanguages.length) {
      const loadedGrammars = (await Promise.all(pendingLanguages.map(loadGrammar))).filter(Boolean);
      pendingLanguages = [...new Set(loadedGrammars.flatMap(grammar =>
        grammar.dependencies || [...externalLanguagesFor(grammar)]
      ))].filter(language => !grammarModules.has(language));
    }

    requestedLanguages.forEach(({ requested, canonical }) => {
      if (grammars.byLanguage[canonical]) {
        grammars.byLanguage[requested] = grammars.byLanguage[canonical];
      }
    });

    return grammars;
  };
};
