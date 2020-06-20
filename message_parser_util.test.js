const MessageParserUtil = require('./message_parser_util');

test("Identifies exact state abbreviation.", () => {
  expect(TextParserUtil.determineState("NC")).toBe("North Carolina");
});

test("Ignores case for exact state abbreviation.", () => {
  expect(TextParserUtil.determineState("nc")).toBe("North Carolina");
});

test("Ignores case for exact state abbreviation.", () => {
  expect(TextParserUtil.determineState("n.C.")).toBe("North Carolina");
});

test("Identifies exact state abbreviation w/periods.", () => {
  expect(TextParserUtil.determineState("W.I.")).toBe("Wisconsin");
});

test("Ignores case for exact state abbreviation w/periods.", () => {
  expect(TextParserUtil.determineState("w.I.")).toBe("Wisconsin");
});

test("Identifies state abbreviation within a sentence.", () => {
  expect(TextParserUtil.determineState("I want to vote in NC please")).toBe("North Carolina");
});

test("Identifies state abbreviation within a sentence, ignores case and periods.", () => {
  expect(TextParserUtil.determineState("I want to vote in w.I. please")).toBe("Wisconsin");
});

test("Identifies state abbreviation at start of a sentence.", () => {
  expect(TextParserUtil.determineState("WI please")).toBe("Wisconsin");
});

test("Identifies state abbreviation at start of a sentence, ignores case and spacing.", () => {
  expect(TextParserUtil.determineState("N.c. please")).toBe("North Carolina");
});

test("Identifies state abbreviation at end of a sentence.", () => {
  expect(TextParserUtil.determineState("I want to vote in WI.")).toBe("Wisconsin");
});

test("Identifies state abbreviation at end of a sentence, ignores case and spacing.", () => {
  expect(TextParserUtil.determineState("I want to vote in N.c...")).toBe("North Carolina");
});

test("Returns null for message without state intent.", () => {
  // "wi" is inside of "with"
  expect(TextParserUtil.determineState("I'm not sure.")).toBe(null);
});

test("Does not interpret parts of words as state abbreviation intent.", () => {
  // "wi" is inside of "with"
  expect(TextParserUtil.determineState("I need help with voting")).toBe(null);
  // "nc" is inside of "once"
  expect(TextParserUtil.determineState("How do I vote once I register")).toBe(null);
});

test("Filters inconsistent punctuation around state abbreviations.", () => {
  expect(TextParserUtil.determineState("wi.")).toBe("Wisconsin");
  expect(TextParserUtil.determineState("w.i")).toBe("Wisconsin");
  expect(TextParserUtil.determineState("wi..")).toBe("Wisconsin");
});

test("Identifies exact state name.", () => {
  expect(TextParserUtil.determineState("North Carolina")).toBe("North Carolina");
});

test("Ignores case in exact state name.", () => {
  expect(TextParserUtil.determineState("noRtH CaRolinA")).toBe("North Carolina");
});

test("Ignores case in exact state name.", () => {
  expect(TextParserUtil.determineState("noRtH CaRolinA")).toBe("North Carolina");
});

test("Identifies state name with missing space.", () => {
  expect(TextParserUtil.determineState("noRtHCaRolinA")).toBe("North Carolina");
});

test("Identifies state name within a sentence.", () => {
  expect(TextParserUtil.determineState("I want to vote in North Carolina please")).toBe("North Carolina");
});

test("Identifies state name within a sentence, ignores case and spacing.", () => {
  expect(TextParserUtil.determineState("I want to vote in noRtHCaRolinA please")).toBe("North Carolina");
});

test("Identifies state name at start of a sentence.", () => {
  expect(TextParserUtil.determineState("North Carolina please")).toBe("North Carolina");
});

test("Identifies state name at start of a sentence, ignores case and spacing.", () => {
  expect(TextParserUtil.determineState("noRtHCaRolinA please")).toBe("North Carolina");
});

test("Identifies state name at end of a sentence.", () => {
  expect(TextParserUtil.determineState("I want to vote in North Carolina")).toBe("North Carolina");
});

test("Identifies state name at end of a sentence, ignores case and spacing.", () => {
  expect(TextParserUtil.determineState("I want to vote in noRtHCaRolinA")).toBe("North Carolina");
});

test("Handles state name adjacent to punctuation.", () => {
  expect(TextParserUtil.determineState("I want to vote in NorThCaRolinA..")).toBe("North Carolina");
});

test("Handles abbreviation of only name part.", () => {
  expect(TextParserUtil.determineState("I want to vote in NCarolina")).toBe("North Carolina");
});

test("Handles abbreviation of only name part, with period.", () => {
  expect(TextParserUtil.determineState("I want to vote in N.Carolina")).toBe("North Carolina");
});
