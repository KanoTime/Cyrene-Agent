import fs from "fs";
import path from "path";

export type CharacterCorpusIssue = Readonly<{
  code: string;
  message: string;
  line?: number;
  entryId?: string;
  field?: string;
}>;

export type CharacterCorpusReport = Readonly<{
  schemaVersion: 1;
  characterId: string;
  status: "passed" | "blocked";
  counts: Readonly<{
    verifiedEntries: number;
    verifiedJapanese: number;
    verifiedChinese: number;
    officialChinesePairs: number;
    sourceCategories: number;
  }>;
  sourceCategoryBreakdown: Readonly<Record<string, number>>;
  coverage: Readonly<Record<string, Readonly<{
    actual: number;
    required: number;
    status: "met" | "missing" | "excepted";
  }>>>;
  exceptions: readonly Readonly<{
    scenario: string;
    status: "approved";
    reason: string;
    reviewedBy: string;
    evidence: string;
  }>[];
  issues: readonly CharacterCorpusIssue[];
}>;

type CorpusManifest = {
  schemaVersion: 1;
  characterId: string;
  thresholds: {
    verifiedJapanese: number;
    officialChinesePairs: number;
    sourceCategories: number;
    requiredScenarios: Record<string, number>;
  };
  sources: Array<{
    id: string;
    title: string;
    category: string;
    authorityLevel: number;
    url?: string;
    evidencePath?: string;
    contentHash: string;
  }>;
  exceptions: Array<{
    scenario: string;
    status: string;
    reason: string;
    reviewedBy: string;
    evidence: string;
  }>;
};

type CorpusEntry = {
  line: number;
  schemaVersion: 1;
  id: string;
  sourceId: string;
  server: string;
  text: string;
  speaker: string;
  sourceHash: string;
  language: string;
  pairId?: string;
  characterForm: string;
  scenarioTags: string[];
  review: { status: string; method: string };
  locator: {
    kind: string;
    unitId: string;
    scene: string;
    url?: string;
    chapter?: string;
    timestamp?: string;
  };
  evidenceCategory: string;
  confidence: string;
};

const LANGUAGES = new Set(["ja", "zh-CN"]);
const SERVERS = new Set(["jp", "cn", "global", "not-applicable"]);
const EVIDENCE_CATEGORIES = new Set([
  "official-fact",
  "official-dialogue",
  "personality-inference",
  "language-feature",
  "assistant-adaptation",
  "user-review",
]);
const CONFIDENCE_LEVELS = new Set(["A", "B", "C", "D"]);
const REVIEW_METHODS = new Set(["official-text", "visual", "audio", "ocr", "asr"]);
const SOURCE_CATEGORIES = new Set([
  "in-game-story",
  "in-game-relationship",
  "in-game-voice",
  "official-site",
  "official-video",
  "official-publication",
]);
const IN_GAME_SOURCE_CATEGORIES = new Set([
  "in-game-story",
  "in-game-relationship",
  "in-game-voice",
]);
const SOURCE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonLines(filePath: string): Readonly<{
  entries: CorpusEntry[];
  issues: CharacterCorpusIssue[];
}> {
  const entries: CorpusEntry[] = [];
  const issues: CharacterCorpusIssue[] = [];
  fs.readFileSync(filePath, "utf8").split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) throw new Error("not an object");
      const entryId = typeof parsed["id"] === "string" ? parsed["id"] : undefined;
      const missingFields = [
        "id", "sourceId", "server", "language", "text", "speaker", "characterForm", "sourceHash",
      ].filter((field) => (
        typeof parsed[field] !== "string" || !parsed[field].trim()
      ));
      for (const field of missingFields) {
        issues.push({
          code: "corpus.entry.missing_field",
          line: index + 1,
          ...(entryId ? { entryId } : {}),
          field,
          message: `语料记录缺少必填字段：${field}`,
        });
      }
      const invalidFields: string[] = [];
      if (parsed["schemaVersion"] !== 1) invalidFields.push("schemaVersion");
      if (typeof parsed["language"] === "string" && !LANGUAGES.has(parsed["language"])) {
        invalidFields.push("language");
      }
      if (typeof parsed["server"] === "string" && !SERVERS.has(parsed["server"])) {
        invalidFields.push("server");
      }
      if (typeof parsed["characterForm"] === "string"
        && !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(parsed["characterForm"])) {
        invalidFields.push("characterForm");
      }
      if (typeof parsed["sourceHash"] === "string" && !SOURCE_HASH_PATTERN.test(parsed["sourceHash"])) {
        invalidFields.push("sourceHash");
      }
      if (!isRecord(parsed["locator"])) {
        invalidFields.push("locator");
      } else {
        const locator = parsed["locator"];
        if (typeof locator["kind"] !== "string" || !locator["kind"].trim()) {
          invalidFields.push("locator.kind");
        }
        if (typeof locator["unitId"] !== "string" || !locator["unitId"].trim()) {
          invalidFields.push("locator.unitId");
        }
        if (typeof locator["scene"] !== "string" || !locator["scene"].trim()) {
          invalidFields.push("locator.scene");
        }
        if (![locator["url"], locator["chapter"], locator["timestamp"]]
          .some((value) => typeof value === "string" && value.trim())) {
          invalidFields.push("locator.reference");
        }
        if (locator["kind"] === "in-game-capture") {
          if (typeof locator["chapter"] !== "string" || !locator["chapter"].trim()) {
            invalidFields.push("locator.chapter");
          }
          if (typeof locator["timestamp"] !== "string" || !locator["timestamp"].trim()) {
            invalidFields.push("locator.timestamp");
          }
        }
      }
      if (!isRecord(parsed["review"])) {
        invalidFields.push("review");
      } else {
        const review = parsed["review"];
        if (review["status"] !== "verified" && review["status"] !== "unverified") {
          invalidFields.push("review.status");
        }
        if (typeof review["method"] !== "string" || !REVIEW_METHODS.has(review["method"])) {
          invalidFields.push("review.method");
        }
        if (review["status"] === "verified"
          && (typeof review["reviewedAt"] !== "string" || !review["reviewedAt"].trim())) {
          invalidFields.push("review.reviewedAt");
        }
      }
      if (typeof parsed["evidenceCategory"] !== "string"
        || !EVIDENCE_CATEGORIES.has(parsed["evidenceCategory"])) {
        invalidFields.push("evidenceCategory");
      }
      if (typeof parsed["confidence"] !== "string"
        || !CONFIDENCE_LEVELS.has(parsed["confidence"])) {
        invalidFields.push("confidence");
      }
      if (!Array.isArray(parsed["scenarioTags"])
        || parsed["scenarioTags"].some((tag) => typeof tag !== "string" || !tag.trim())) {
        invalidFields.push("scenarioTags");
      }
      if (parsed["pairId"] !== undefined
        && (typeof parsed["pairId"] !== "string" || !parsed["pairId"].trim())) {
        invalidFields.push("pairId");
      }
      for (const field of invalidFields) {
        issues.push({
          code: "corpus.entry.invalid_field",
          line: index + 1,
          ...(entryId ? { entryId } : {}),
          field,
          message: `语料记录字段无效：${field}`,
        });
      }
      if (missingFields.length === 0 && invalidFields.length === 0) {
        entries.push({ ...(parsed as unknown as Omit<CorpusEntry, "line">), line: index + 1 });
      }
    } catch {
      issues.push({
        code: "corpus.entry.invalid_json",
        line: index + 1,
        message: "语料记录不是有效 JSON",
      });
    }
  });
  return { entries, issues };
}

function blockedReport(issues: CharacterCorpusIssue[]): CharacterCorpusReport {
  return Object.freeze({
    schemaVersion: 1,
    characterId: "unknown",
    status: "blocked",
    counts: Object.freeze({
      verifiedEntries: 0,
      verifiedJapanese: 0,
      verifiedChinese: 0,
      officialChinesePairs: 0,
      sourceCategories: 0,
    }),
    sourceCategoryBreakdown: Object.freeze({}),
    coverage: Object.freeze({}),
    exceptions: Object.freeze([]),
    issues: Object.freeze(issues),
  });
}

function parseCorpusManifest(value: unknown): Readonly<{
  manifest?: CorpusManifest;
  issues: CharacterCorpusIssue[];
}> {
  const issues: CharacterCorpusIssue[] = [];
  const invalid = (field: string) => issues.push({
    code: "corpus.manifest.invalid_field",
    field,
    message: `Character Corpus 清单字段无效：${field}`,
  });
  if (!isRecord(value)) {
    invalid("root");
    return { issues };
  }
  if (value["schemaVersion"] !== 1) invalid("schemaVersion");
  if (typeof value["characterId"] !== "string" || !value["characterId"].trim()) {
    invalid("characterId");
  }
  const thresholds = value["thresholds"];
  if (!isRecord(thresholds)) {
    invalid("thresholds");
  } else {
    for (const field of ["verifiedJapanese", "officialChinesePairs", "sourceCategories"]) {
      const count = thresholds[field];
      if (!Number.isInteger(count) || (count as number) < 1) invalid(`thresholds.${field}`);
    }
    const requiredScenarios = thresholds["requiredScenarios"];
    if (!isRecord(requiredScenarios)) {
      invalid("thresholds.requiredScenarios");
    } else {
      for (const [scenario, count] of Object.entries(requiredScenarios)) {
        if (!scenario.trim() || !Number.isInteger(count) || (count as number) < 1) {
          invalid(`thresholds.requiredScenarios.${scenario}`);
        }
      }
    }
  }
  if (!Array.isArray(value["sources"])) {
    invalid("sources");
  } else {
    const sourceIds = new Set<string>();
    value["sources"].forEach((source, index) => {
      const prefix = `sources.${index}`;
      if (!isRecord(source)) {
        invalid(prefix);
        return;
      }
      if (typeof source["id"] !== "string" || !source["id"].trim()
        || sourceIds.has(source["id"])) {
        invalid(`${prefix}.id`);
      } else {
        sourceIds.add(source["id"]);
      }
      if (typeof source["title"] !== "string" || !source["title"].trim()) {
        invalid(`${prefix}.title`);
      }
      if (typeof source["category"] !== "string"
        || !SOURCE_CATEGORIES.has(source["category"])) {
        invalid(`${prefix}.category`);
      }
      if (!Number.isInteger(source["authorityLevel"])
        || (source["authorityLevel"] as number) < 1
        || (source["authorityLevel"] as number) > 5) {
        invalid(`${prefix}.authorityLevel`);
      }
      if (![source["url"], source["evidencePath"]]
        .some((reference) => typeof reference === "string" && reference.trim())) {
        invalid(`${prefix}.reference`);
      }
      if (typeof source["category"] === "string"
        && IN_GAME_SOURCE_CATEGORIES.has(source["category"])) {
        const evidencePath = source["evidencePath"];
        if (typeof evidencePath !== "string" || !evidencePath.trim()
          || path.isAbsolute(evidencePath)
          || evidencePath.split(/[\\/]/u).includes("..")) {
          invalid(`${prefix}.evidencePath`);
        }
      }
      if (typeof source["contentHash"] !== "string"
        || !SOURCE_HASH_PATTERN.test(source["contentHash"])) {
        invalid(`${prefix}.contentHash`);
      }
    });
  }
  if (!Array.isArray(value["exceptions"])) {
    invalid("exceptions");
  } else {
    const exceptionScenarios = new Set<string>();
    value["exceptions"].forEach((exception, index) => {
      const prefix = `exceptions.${index}`;
      if (!isRecord(exception)) {
        invalid(prefix);
        return;
      }
      for (const field of ["scenario", "reason", "reviewedBy", "evidence"]) {
        if (typeof exception[field] !== "string" || !exception[field].trim()) {
          invalid(`${prefix}.${field}`);
        }
      }
      if (exception["status"] !== "approved") invalid(`${prefix}.status`);
      if (typeof exception["scenario"] === "string" && exception["scenario"].trim()) {
        if (exceptionScenarios.has(exception["scenario"])) invalid(`${prefix}.scenario`);
        exceptionScenarios.add(exception["scenario"]);
        const requiredScenarios = isRecord(thresholds)
          ? thresholds["requiredScenarios"]
          : undefined;
        if (isRecord(requiredScenarios) && !(exception["scenario"] in requiredScenarios)) {
          invalid(`${prefix}.scenario`);
        }
      }
    });
  }
  return issues.length === 0
    ? { manifest: value as unknown as CorpusManifest, issues }
    : { issues };
}

export function evaluateCharacterCorpus(corpusRoot: string): CharacterCorpusReport {
  const manifestPath = path.join(corpusRoot, "corpus.json");
  const entriesPath = path.join(corpusRoot, "entries.jsonl");
  const missingIssues: CharacterCorpusIssue[] = [];
  if (!fs.existsSync(manifestPath)) {
    missingIssues.push({
      code: "corpus.manifest.missing",
      message: "缺少 Character Corpus 清单：corpus.json",
    });
  }
  if (!fs.existsSync(entriesPath)) {
    missingIssues.push({
      code: "corpus.entries.missing",
      message: "缺少 Character Corpus 记录：entries.jsonl",
    });
  }
  if (missingIssues.length > 0) return blockedReport(missingIssues);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return blockedReport([{
      code: "corpus.manifest.invalid_json",
      message: "Character Corpus 清单不是有效 JSON",
    }]);
  }
  const parsedManifest = parseCorpusManifest(rawManifest);
  if (!parsedManifest.manifest) return blockedReport(parsedManifest.issues);
  const manifest = parsedManifest.manifest;
  const parsedEntries = readJsonLines(entriesPath);
  const issues = [...parsedEntries.issues];
  const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
  const seenIds = new Set<string>();
  const seenContent = new Map<string, string>();
  const entries: CorpusEntry[] = [];
  for (const entry of parsedEntries.entries) {
    let valid = true;
    if (seenIds.has(entry.id)) {
      issues.push({
        code: "corpus.entry.duplicate_id",
        message: `语料记录 ID 重复：${entry.id}`,
        line: entry.line,
        entryId: entry.id,
      });
      valid = false;
    } else {
      seenIds.add(entry.id);
    }
    const contentKey = [
      entry.server,
      entry.language,
      entry.speaker.normalize("NFKC").trim(),
      entry.characterForm,
      entry.text.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    ].join("\u0000");
    const duplicateOf = seenContent.get(contentKey);
    if (duplicateOf) {
      issues.push({
        code: "corpus.entry.duplicate_content",
        message: `语料内容重复：${entry.id}（与 ${duplicateOf} 相同）`,
        line: entry.line,
        entryId: entry.id,
        field: "text",
      });
      valid = false;
    } else {
      seenContent.set(contentKey, entry.id);
    }
    const source = sourceById.get(entry.sourceId);
    if (!source) {
      issues.push({
        code: "corpus.entry.source_missing",
        message: `语料记录引用了不存在的来源：${entry.sourceId}`,
        line: entry.line,
        entryId: entry.id,
        field: "sourceId",
      });
      valid = false;
    } else if (entry.sourceHash !== source.contentHash) {
      issues.push({
        code: "corpus.entry.source_hash_mismatch",
        message: `语料记录的来源哈希与来源目录不一致：${entry.id}`,
        line: entry.line,
        entryId: entry.id,
        field: "sourceHash",
      });
      valid = false;
    }
    if (source && IN_GAME_SOURCE_CATEGORIES.has(source.category)
      && entry.locator.kind !== "in-game-capture") {
      issues.push({
        code: "corpus.entry.invalid_source_locator",
        message: `游戏内来源必须使用包含章节与时间点的采集定位：${entry.id}`,
        line: entry.line,
        entryId: entry.id,
        field: "locator.kind",
      });
      valid = false;
    }
    if (entry.review.status !== "verified") {
      issues.push({
        code: "corpus.entry.unverified",
        message: `语料记录尚未人工复核：${entry.id}`,
        line: entry.line,
        entryId: entry.id,
        field: "review.status",
      });
      valid = false;
    }
    if (valid) entries.push(entry);
  }
  const pairCandidates = new Map<string, CorpusEntry[]>();
  for (const entry of parsedEntries.entries) {
    if (!entry.pairId) continue;
    const paired = pairCandidates.get(entry.pairId) ?? [];
    paired.push(entry);
    pairCandidates.set(entry.pairId, paired);
  }
  const validEntryIds = new Set(entries.map(({ id }) => id));
  const validPairIds = new Set<string>();
  for (const [pairId, paired] of pairCandidates) {
    const validPaired = paired.filter(({ id }) => validEntryIds.has(id));
    const japanesePair = validPaired.filter(({ language }) => language === "ja");
    const chinesePair = validPaired.filter(({ language }) => language === "zh-CN");
    const sameIdentity = japanesePair.length === 1 && chinesePair.length === 1
      && japanesePair[0].server === "jp"
      && chinesePair[0].server === "cn"
      && japanesePair[0].evidenceCategory === "official-dialogue"
      && chinesePair[0].evidenceCategory === "official-dialogue"
      && japanesePair[0].speaker === chinesePair[0].speaker
      && japanesePair[0].characterForm === chinesePair[0].characterForm
      && japanesePair[0].locator.unitId === chinesePair[0].locator.unitId;
    if (sameIdentity) {
      validPairIds.add(pairId);
    } else {
      issues.push({
        code: "corpus.pair.invalid",
        message: `双语配对必须包含同一来源单元、说话者与形态的一条复核日文和一条复核国服中文：${pairId}`,
      });
    }
  }
  const verified = entries;
  const japanese = verified.filter((entry) => (
    entry.server === "jp"
    && entry.language === "ja"
    && entry.evidenceCategory === "official-dialogue"
  ));
  const chinese = verified.filter((entry) => (
    entry.server === "cn"
    && entry.language === "zh-CN"
    && entry.evidenceCategory === "official-dialogue"
  ));
  const officialChinesePairs = validPairIds.size;
  const approvedExceptions = manifest.exceptions.filter((exception) => (
    exception.status === "approved"
    && Boolean(exception.scenario.trim())
    && Boolean(exception.reason.trim())
    && Boolean(exception.reviewedBy.trim())
    && Boolean(exception.evidence.trim())
  )) as CharacterCorpusReport["exceptions"];
  const approvedExceptionScenarios = new Set(approvedExceptions.map(({ scenario }) => scenario));
  const coverage = Object.fromEntries(
    Object.entries(manifest.thresholds.requiredScenarios).map(([scenario, required]) => {
      const actual = verified.filter((entry) => entry.scenarioTags.includes(scenario)).length;
      const status = actual >= required
        ? "met"
        : approvedExceptionScenarios.has(scenario)
          ? "excepted"
          : "missing";
      return [scenario, { actual, required, status }];
    }),
  ) as CharacterCorpusReport["coverage"];
  const sourceCategoryBreakdown = entries.reduce<Record<string, number>>((counts, entry) => {
    const category = sourceById.get(entry.sourceId)?.category;
    if (category) counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});
  const sourceCategories = Object.keys(sourceCategoryBreakdown).length;
  if (japanese.length < manifest.thresholds.verifiedJapanese) {
    issues.push({
      code: "corpus.threshold.verified_japanese",
      message: `人工复核日文语料不足：${japanese.length}/${manifest.thresholds.verifiedJapanese}`,
    });
  }
  if (officialChinesePairs < manifest.thresholds.officialChinesePairs) {
    issues.push({
      code: "corpus.threshold.official_chinese_pairs",
      message: `国服官方中文配对不足：${officialChinesePairs}/${manifest.thresholds.officialChinesePairs}`,
    });
  }
  if (sourceCategories < manifest.thresholds.sourceCategories) {
    issues.push({
      code: "corpus.threshold.source_categories",
      message: `已复核语料来源类别不足：${sourceCategories}/${manifest.thresholds.sourceCategories}`,
    });
  }
  for (const [scenario, state] of Object.entries(coverage)) {
    if (state.status !== "missing") continue;
    issues.push({
      code: "corpus.threshold.scenario",
      message: `场景覆盖不足：${scenario} ${state.actual}/${state.required}`,
      field: `thresholds.requiredScenarios.${scenario}`,
    });
  }
  const passed = issues.length === 0
    && japanese.length >= manifest.thresholds.verifiedJapanese
    && officialChinesePairs >= manifest.thresholds.officialChinesePairs
    && sourceCategories >= manifest.thresholds.sourceCategories
    && Object.values(coverage).every(({ status }) => status !== "missing");

  return Object.freeze({
    schemaVersion: 1,
    characterId: manifest.characterId,
    status: passed ? "passed" : "blocked",
    counts: Object.freeze({
      verifiedEntries: verified.length,
      verifiedJapanese: japanese.length,
      verifiedChinese: chinese.length,
      officialChinesePairs,
      sourceCategories,
    }),
    sourceCategoryBreakdown: Object.freeze(sourceCategoryBreakdown),
    coverage: Object.freeze(coverage),
    exceptions: Object.freeze(approvedExceptions),
    issues: Object.freeze(issues),
  });
}
