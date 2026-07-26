import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { evaluateCharacterCorpus } from "./character-corpus";

describe("Character Corpus Gate", () => {
  it("accepts a reviewed, traceable, license-safe corpus", () => {
    const report = evaluateCharacterCorpus(
      path.join(process.cwd(), "test-fixtures", "corpora", "lumen"),
    );

    expect(report).toMatchObject({
      schemaVersion: 1,
      characterId: "fixture.lumen",
      status: "passed",
      counts: {
        verifiedEntries: 2,
        verifiedJapanese: 1,
        verifiedChinese: 1,
        officialChinesePairs: 1,
        sourceCategories: 1,
      },
      sourceCategoryBreakdown: {
        "official-site": 2,
      },
      coverage: {
        daily_relaxed: { actual: 2, required: 1, status: "met" },
      },
      issues: [],
    });
  });

  it("reports a malformed evidence line without crashing the gate", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-invalid-json-"));
    fs.copyFileSync(
      path.join(process.cwd(), "test-fixtures", "corpora", "lumen", "corpus.json"),
      path.join(root, "corpus.json"),
    );
    fs.writeFileSync(path.join(root, "entries.jsonl"), "{not-json}\n");

    const report = evaluateCharacterCorpus(root);
    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
        code: "corpus.entry.invalid_json",
        line: 1,
        message: "语料记录不是有效 JSON",
      })]));
  });

  it("rejects an evidence record without required server, speaker, and source hash provenance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-missing-fields-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const entry = JSON.parse(
      fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8").split("\n")[0],
    ) as Record<string, unknown>;
    delete entry["server"];
    delete entry["speaker"];
    delete entry["sourceHash"];
    fs.writeFileSync(path.join(root, "entries.jsonl"), `${JSON.stringify(entry)}\n`);

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "corpus.entry.missing_field",
        entryId: "lumen-daily-ja",
        field: "server",
        line: 1,
      }),
      expect.objectContaining({
        code: "corpus.entry.missing_field",
        entryId: "lumen-daily-ja",
        field: "speaker",
        line: 1,
      }),
      expect.objectContaining({
        code: "corpus.entry.missing_field",
        entryId: "lumen-daily-ja",
        field: "sourceHash",
        line: 1,
      }),
    ]));
  });

  it("reports duplicate, unreviewed, untraceable, and invalid bilingual evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-traceability-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const [japanese, chinese] = fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const unreviewedChinese = {
      ...chinese,
      review: { status: "unverified", method: "ocr" },
      sourceHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const missingSource = {
      ...japanese,
      id: "lumen-orphan-ja",
      sourceId: "missing-source",
      pairId: "lumen-orphan-1",
    };
    fs.writeFileSync(path.join(root, "entries.jsonl"), [
      JSON.stringify(japanese),
      JSON.stringify(japanese),
      JSON.stringify(unreviewedChinese),
      JSON.stringify(missingSource),
    ].join("\n") + "\n");

    const report = evaluateCharacterCorpus(root);
    const codes = report.issues.map(({ code }) => code);

    expect(report.status).toBe("blocked");
    expect(codes).toEqual(expect.arrayContaining([
      "corpus.entry.duplicate_id",
      "corpus.entry.unverified",
      "corpus.entry.source_hash_mismatch",
      "corpus.entry.source_missing",
      "corpus.pair.invalid",
    ]));
  });

  it("rejects duplicate evidence text even when record IDs differ", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-duplicate-content-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const lines = fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8").trim().split("\n");
    const duplicate = JSON.parse(lines[0]) as Record<string, unknown>;
    duplicate["id"] = "lumen-daily-ja-copy";
    delete duplicate["pairId"];
    fs.writeFileSync(path.join(root, "entries.jsonl"), [
      ...lines,
      JSON.stringify(duplicate),
    ].join("\n") + "\n");

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "corpus.entry.duplicate_content",
      entryId: "lumen-daily-ja-copy",
      line: 3,
    })]));
  });

  it("counts a bilingual pair only when it links JP Japanese to official CN Chinese", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-non-cn-pair-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const entries = fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    entries[1]["server"] = "global";
    fs.writeFileSync(path.join(root, "entries.jsonl"), entries
      .map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.counts.officialChinesePairs).toBe(0);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "corpus.pair.invalid",
    })]));
  });

  it("does not count personality inferences as verified Japanese utterances", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-inference-count-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture, "corpus.json"), "utf8"),
    ) as Record<string, any>;
    manifest.thresholds.verifiedJapanese = 2;
    fs.writeFileSync(path.join(root, "corpus.json"), JSON.stringify(manifest));
    const lines = fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8").trim().split("\n");
    const inference = JSON.parse(lines[0]) as Record<string, unknown>;
    inference["id"] = "lumen-personality-inference-ja";
    inference["text"] = "日常では穏やかに振る舞う。";
    inference["evidenceCategory"] = "personality-inference";
    delete inference["pairId"];
    fs.writeFileSync(path.join(root, "entries.jsonl"), [
      ...lines,
      JSON.stringify(inference),
    ].join("\n") + "\n");

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.counts).toMatchObject({ verifiedEntries: 3, verifiedJapanese: 1 });
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "corpus.threshold.verified_japanese",
      message: "人工复核日文语料不足：1/2",
    })]));
  });

  it("does not count non-dialogue research records as official Chinese pairs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-research-pair-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const entries = fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    entries.forEach((entry) => { entry["evidenceCategory"] = "user-review"; });
    fs.writeFileSync(path.join(root, "entries.jsonl"), entries
      .map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.counts.officialChinesePairs).toBe(0);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "corpus.pair.invalid",
    })]));
  });

  it("rejects a bilingual pair whose records point to different source units", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-unit-pair-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const entries = fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, any>);
    entries[1].locator.unitId = "lumen.evening.001";
    fs.writeFileSync(path.join(root, "entries.jsonl"), entries
      .map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.counts.officialChinesePairs).toBe(0);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "corpus.pair.invalid",
    })]));
  });

  it("explains every unmet gate threshold", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-thresholds-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    fs.writeFileSync(path.join(root, "entries.jsonl"), "");

    const report = evaluateCharacterCorpus(root);

    expect(report).toMatchObject({
      status: "blocked",
      counts: {
        verifiedJapanese: 0,
        officialChinesePairs: 0,
        sourceCategories: 0,
      },
      coverage: {
        daily_relaxed: { actual: 0, required: 1, status: "missing" },
      },
    });
    expect(report.issues.map(({ code }) => code)).toEqual([
      "corpus.threshold.verified_japanese",
      "corpus.threshold.official_chinese_pairs",
      "corpus.threshold.source_categories",
      "corpus.threshold.scenario",
    ]);
  });

  it("reports an approved natural-scarcity exception without fabricating evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-exception-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "corpus.json"), "utf8")) as any;
    manifest.thresholds.requiredScenarios.rare_trauma = 1;
    manifest.exceptions = [{
      scenario: "rare_trauma",
      status: "approved",
      reason: "许可安全夹具没有创伤场景，不能为满足数量伪造内容。",
      reviewedBy: "fixture-maintainer",
      evidence: "完整检查了许可安全夹具的全部来源目录。",
    }];
    fs.writeFileSync(path.join(root, "corpus.json"), JSON.stringify(manifest));
    fs.copyFileSync(path.join(fixture, "entries.jsonl"), path.join(root, "entries.jsonl"));

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("passed");
    expect(report.coverage.rare_trauma).toEqual({ actual: 0, required: 1, status: "excepted" });
    expect(report.exceptions).toEqual([expect.objectContaining({
      scenario: "rare_trauma",
      status: "approved",
    })]);
  });

  it("rejects unsupported language, evidence category, confidence, and source locator", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-invalid-schema-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const entry = JSON.parse(
      fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8").split("\n")[0],
    ) as Record<string, unknown>;
    entry["language"] = "en";
    entry["evidenceCategory"] = "community-impression";
    entry["confidence"] = "Z";
    entry["locator"] = { kind: "official-page" };
    fs.writeFileSync(path.join(root, "entries.jsonl"), `${JSON.stringify(entry)}\n`);

    const report = evaluateCharacterCorpus(root);
    const invalidFields = report.issues
      .filter(({ code }) => code === "corpus.entry.invalid_field")
      .map(({ field }) => field);

    expect(report.status).toBe("blocked");
    expect(invalidFields).toEqual(expect.arrayContaining([
      "language",
      "evidenceCategory",
      "confidence",
      "locator.scene",
      "locator.reference",
    ]));
  });

  it("requires chapter and timestamp provenance for in-game captures", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-game-locator-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    fs.copyFileSync(path.join(fixture, "corpus.json"), path.join(root, "corpus.json"));
    const entry = JSON.parse(
      fs.readFileSync(path.join(fixture, "entries.jsonl"), "utf8").split("\n")[0],
    ) as Record<string, unknown>;
    entry["locator"] = {
      kind: "in-game-capture",
      scene: "Abydos main story",
      url: "https://example.invalid/not-enough-for-game-evidence",
    };
    fs.writeFileSync(path.join(root, "entries.jsonl"), `${JSON.stringify(entry)}\n`);

    const report = evaluateCharacterCorpus(root);
    const invalidFields = report.issues
      .filter(({ code }) => code === "corpus.entry.invalid_field")
      .map(({ field }) => field);

    expect(report.status).toBe("blocked");
    expect(invalidFields).toEqual(expect.arrayContaining([
      "locator.chapter",
      "locator.timestamp",
    ]));
  });

  it("cannot disguise an in-game source as an official page to bypass provenance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-disguised-game-source-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture, "corpus.json"), "utf8"),
    ) as Record<string, any>;
    manifest.sources[0].category = "in-game-story";
    manifest.sources[0].evidencePath = "fixture.lumen/raw/story-capture.mov";
    fs.writeFileSync(path.join(root, "corpus.json"), JSON.stringify(manifest));
    fs.copyFileSync(path.join(fixture, "entries.jsonl"), path.join(root, "entries.jsonl"));

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "corpus.entry.invalid_source_locator",
      entryId: "lumen-daily-ja",
      field: "locator.kind",
    })]));
  });

  it("returns actionable diagnostics when the corpus files are missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-missing-files-"));

    const report = evaluateCharacterCorpus(root);

    expect(report).toMatchObject({
      characterId: "unknown",
      status: "blocked",
      counts: {
        verifiedEntries: 0,
        verifiedJapanese: 0,
        officialChinesePairs: 0,
        sourceCategories: 0,
      },
    });
    expect(report.issues.map(({ code }) => code)).toEqual([
      "corpus.manifest.missing",
      "corpus.entries.missing",
    ]);
  });

  it("returns a diagnostic for a corrupted corpus manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-invalid-manifest-"));
    fs.writeFileSync(path.join(root, "corpus.json"), "{broken-json}");
    fs.writeFileSync(path.join(root, "entries.jsonl"), "");

    expect(evaluateCharacterCorpus(root)).toMatchObject({
      characterId: "unknown",
      status: "blocked",
      issues: [{
        code: "corpus.manifest.invalid_json",
        message: "Character Corpus 清单不是有效 JSON",
      }],
    });
  });

  it("rejects an invalid corpus manifest schema without throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-invalid-manifest-schema-"));
    fs.writeFileSync(path.join(root, "corpus.json"), JSON.stringify({
      schemaVersion: 2,
      characterId: "",
      thresholds: {
        verifiedJapanese: -1,
        officialChinesePairs: "sixty",
        sourceCategories: 0,
        requiredScenarios: { daily_relaxed: -1 },
      },
      sources: "not-an-array",
      exceptions: {},
    }));
    fs.writeFileSync(path.join(root, "entries.jsonl"), "");

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "schemaVersion" }),
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "characterId" }),
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "thresholds.verifiedJapanese" }),
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "thresholds.officialChinesePairs" }),
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "thresholds.sourceCategories" }),
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "thresholds.requiredScenarios.daily_relaxed" }),
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "sources" }),
      expect.objectContaining({ code: "corpus.manifest.invalid_field", field: "exceptions" }),
    ]));
  });

  it("rejects malformed and duplicate source catalog entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-invalid-sources-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture, "corpus.json"), "utf8"),
    ) as Record<string, any>;
    manifest.sources = [{
      id: "lumen-official-fixture",
      title: "",
      category: "fan-wiki",
      authorityLevel: 0,
      contentHash: "not-a-hash",
    }, {
      id: "lumen-official-fixture",
      title: "Duplicate",
      category: "official-site",
      authorityLevel: 1,
      url: "https://example.invalid/duplicate",
      contentHash: "sha256:6e5043d5b768afe4bba79a24da14d5c360e6694f2f04ffb1445334beeb65b7fb",
    }];
    fs.writeFileSync(path.join(root, "corpus.json"), JSON.stringify(manifest));
    fs.copyFileSync(path.join(fixture, "entries.jsonl"), path.join(root, "entries.jsonl"));

    const report = evaluateCharacterCorpus(root);
    const invalidFields = report.issues
      .filter(({ code }) => code === "corpus.manifest.invalid_field")
      .map(({ field }) => field);

    expect(report.status).toBe("blocked");
    expect(invalidFields).toEqual(expect.arrayContaining([
      "sources.0.title",
      "sources.0.category",
      "sources.0.authorityLevel",
      "sources.0.reference",
      "sources.0.contentHash",
      "sources.1.id",
    ]));
  });

  it("requires Git-external evidence paths for in-game source categories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-game-source-path-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture, "corpus.json"), "utf8"),
    ) as Record<string, any>;
    manifest.sources[0].category = "in-game-story";
    fs.writeFileSync(path.join(root, "corpus.json"), JSON.stringify(manifest));
    fs.copyFileSync(path.join(fixture, "entries.jsonl"), path.join(root, "entries.jsonl"));

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "corpus.manifest.invalid_field",
      field: "sources.0.evidencePath",
    })]));
  });

  it("rejects an incomplete scarcity exception instead of silently waiving coverage", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-corpus-invalid-exception-"));
    const fixture = path.join(process.cwd(), "test-fixtures", "corpora", "lumen");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture, "corpus.json"), "utf8"),
    ) as Record<string, any>;
    manifest.thresholds.requiredScenarios.rare_trauma = 1;
    manifest.exceptions = [{
      scenario: "rare_trauma",
      status: "approved",
      reason: "",
      reviewedBy: "fixture-maintainer",
      evidence: "",
    }];
    fs.writeFileSync(path.join(root, "corpus.json"), JSON.stringify(manifest));
    fs.copyFileSync(path.join(fixture, "entries.jsonl"), path.join(root, "entries.jsonl"));

    const report = evaluateCharacterCorpus(root);

    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "corpus.manifest.invalid_field",
        field: "exceptions.0.reason",
      }),
      expect.objectContaining({
        code: "corpus.manifest.invalid_field",
        field: "exceptions.0.evidence",
      }),
    ]));
  });
});
