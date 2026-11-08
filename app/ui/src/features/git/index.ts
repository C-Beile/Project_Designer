// Öffentliche Seite des Git-Features. Der Kern kennt nur `registerGitPlugin`;
// alles andere holt er über das Register (`core/plugins/registry`) und den Store `core/scm`.
export { registerGitPlugin } from './gitPlugin'
