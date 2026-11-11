// Fixture site for the browser tests (not deployed): pages point at the
// mock OpenList started by playwright.config.ts.
import { defineConfig } from 'vitepress-tuck'
import fileList from 'vitepress-plugin-filelist'

export default defineConfig({
  title: 'FileList e2e',
  plugins: [fileList()],
})
