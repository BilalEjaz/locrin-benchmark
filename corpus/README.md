# corpus

The real benchmark corpus: one `<id>.json` record per diff, naming the source repository, commit, parent commit, licence, language and changed files, plus `<id>/before/` and `<id>/after/` holding the changed source files as they were before and after the commit. Ids take the form `<owner>__<repo>__<7 char sha>`, and records are loaded and validated by `bench.corpus.load_corpus`.
