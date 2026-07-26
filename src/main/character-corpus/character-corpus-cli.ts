import path from "path";
import { evaluateCharacterCorpus } from "./character-corpus";

const corpusRoot = process.argv[2];
if (!corpusRoot) {
  console.error("Usage: npm run corpus:validate -- <corpus-directory>");
  process.exitCode = 2;
} else {
  const report = evaluateCharacterCorpus(path.resolve(corpusRoot));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "passed" ? 0 : 1;
}
