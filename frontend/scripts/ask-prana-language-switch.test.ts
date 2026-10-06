import assert from "node:assert/strict";

import {
  acceptDisplayTranslation,
  canRevealTranslatedSet,
  explicitReplyLanguageCode,
  explicitReplyLanguageLabel,
  isStaleTranslation,
  planLanguageSelection,
  shouldSendTranslation,
  textUntilSetReady,
  translationResponseSucceeded,
} from "../src/lib/ask-prana-translation-policy.ts";

const telugu = "రొయ్యలు మరియు చేపలు pH 7.5, DO 5 mg/L, FCR 1.2, Vannamei, salinity 15 ppt.";
const hindi = "झींगा और मछली का pH 7.5, DO 5 mg/L, FCR 1.2, Vannamei, biomass 200 kg है।";
const english = "Shrimp and fish can be affected by low DO, high ammonia, and sudden pH changes.";

assert.equal(planLanguageSelection({ cached: true, failed: false }).applyLabelsNow, true);
assert.equal(planLanguageSelection({ cached: false, failed: false }).applyLabelsNow, true);
assert.equal(planLanguageSelection({ cached: true, failed: false }).revealContent, true);
assert.equal(planLanguageSelection({ cached: false, failed: false }).revealContent, false);
assert.equal(planLanguageSelection({ cached: true, failed: true }).revealContent, false);
assert.equal(planLanguageSelection({ cached: false, failed: false }).requestMissing, true);
assert.equal(planLanguageSelection({ cached: true, failed: false }).requestMissing, false);

assert.equal(canRevealTranslatedSet(["ready", "ready"]), true);
assert.equal(canRevealTranslatedSet(["ready", "loading"]), false);
assert.equal(canRevealTranslatedSet(["ready", "error"]), false);
assert.equal(canRevealTranslatedSet(["ready", "not_loaded"]), false);

assert.equal(textUntilSetReady(english, telugu, false), english);
assert.equal(textUntilSetReady(english, telugu, true), telugu);
assert.equal(textUntilSetReady(english, null, true), english);

assert.equal(acceptDisplayTranslation({ language: "te", source: english, translated: telugu }), true);
assert.equal(acceptDisplayTranslation({ language: "hi", source: english, translated: hindi }), true);
assert.equal(acceptDisplayTranslation({ language: "te", source: english, translated: english }), false);
assert.equal(acceptDisplayTranslation({ language: "hi", source: english, translated: "   " }), false);
assert.equal(acceptDisplayTranslation({ language: "en", source: telugu, translated: english }), true);
assert.equal(acceptDisplayTranslation({ language: "en", source: telugu, translated: telugu }), false);
assert.equal(
  acceptDisplayTranslation({ language: "te", source: "pH 7.5, DO 5 mg/L, 15 ppm", translated: "pH 7.5, DO 5 mg/L, 15 ppm" }),
  true,
);

assert.equal(explicitReplyLanguageCode("te"), "te");
assert.equal(explicitReplyLanguageCode("Telugu"), "te");
assert.equal(explicitReplyLanguageCode("hi"), "hi");
assert.equal(explicitReplyLanguageCode("en"), "en");
assert.equal(explicitReplyLanguageCode("auto"), null);
assert.equal(explicitReplyLanguageCode(""), null);
assert.equal(explicitReplyLanguageLabel("te"), "Telugu");
assert.equal(explicitReplyLanguageLabel("auto"), null);

assert.equal(shouldSendTranslation("ready", true), false);
assert.equal(shouldSendTranslation("loading", true), false);
assert.equal(shouldSendTranslation("error", false), false);
assert.equal(shouldSendTranslation("error", true), true);
assert.equal(shouldSendTranslation("not_loaded", false), true);
assert.equal(shouldSendTranslation(undefined, false), true);

assert.equal(translationResponseSucceeded({ timedOut: true, httpOk: true, lengthMatches: true }), false);
assert.equal(translationResponseSucceeded({ timedOut: false, httpOk: false, lengthMatches: true }), false);
assert.equal(translationResponseSucceeded({ timedOut: false, httpOk: true, lengthMatches: false }), false);
assert.equal(translationResponseSucceeded({ timedOut: false, httpOk: true, lengthMatches: true }), true);

assert.equal(isStaleTranslation("te", "hi"), true);
assert.equal(isStaleTranslation("te", "te"), false);

console.log("ask-prana language switch tests passed");
