const MessageParserUtil = require('./message_parser_util');

test("Identifies exact state abbreviation.", () => {
  expect(MessageParserUtil.determineState("NC")).toBe("North Carolina");
});

test("Ignores case for exact state abbreviation.", () => {
  expect(MessageParserUtil.determineState("nc")).toBe("North Carolina");
});

test("Ignores case for exact state abbreviation.", () => {
  expect(MessageParserUtil.determineState("n.C.")).toBe("North Carolina");
});

test("Identifies exact state abbreviation w/periods.", () => {
  expect(MessageParserUtil.determineState("F.L.")).toBe("Florida");
});

test("Ignores case for exact state abbreviation w/periods.", () => {
  expect(MessageParserUtil.determineState("f.L.")).toBe("Florida");
});

test("Identifies state abbreviation within a sentence.", () => {
  expect(MessageParserUtil.determineState("I want to vote in NC please")).toBe("North Carolina");
});

test("Identifies state abbreviation within a sentence, ignores case and periods.", () => {
  expect(MessageParserUtil.determineState("I want to vote in f.L. please")).toBe("Florida");
});

test("Identifies state abbreviation at start of a sentence.", () => {
  expect(MessageParserUtil.determineState("FL please")).toBe("Florida");
});

test("Identifies state abbreviation at start of a sentence, ignores case and spacing.", () => {
  expect(MessageParserUtil.determineState("N.c. please")).toBe("North Carolina");
});

test("Identifies state abbreviation at end of a sentence.", () => {
  expect(MessageParserUtil.determineState("I want to vote in FL.")).toBe("Florida");
});

test("Identifies state abbreviation at end of a sentence, ignores case and spacing.", () => {
  expect(MessageParserUtil.determineState("I want to vote in N.c...")).toBe("North Carolina");
});

test("Returns null for message without state intent.", () => {
  // "wi" is inside of "with"
  expect(MessageParserUtil.determineState("I'm not sure.")).toBe(null);
});

test("Does not interpret parts of words as state abbreviation intent.", () => {
  // "wi" is inside of "with"
  expect(MessageParserUtil.determineState("I need help with voting")).toBe(null);
  // "nc" is inside of "once"
  expect(MessageParserUtil.determineState("How do I vote once I register")).toBe(null);
});

test("Filters inconsistent punctuation around state abbreviations.", () => {
  expect(MessageParserUtil.determineState("fl.")).toBe("Florida");
  expect(MessageParserUtil.determineState("Nc.")).toBe("North Carolina");
  expect(MessageParserUtil.determineState("f.l")).toBe("Florida");
  expect(MessageParserUtil.determineState("fl..")).toBe("Florida");
});

test("Identifies exact state name.", () => {
  expect(MessageParserUtil.determineState("North Carolina")).toBe("North Carolina");
});

test("Ignores case in exact state name.", () => {
  expect(MessageParserUtil.determineState("noRtH CaRolinA")).toBe("North Carolina");
});

test("Ignores case in exact state name.", () => {
  expect(MessageParserUtil.determineState("noRtH CaRolinA")).toBe("North Carolina");
});

test("Identifies state name with missing space.", () => {
  expect(MessageParserUtil.determineState("noRtHCaRolinA")).toBe("North Carolina");
});

test("Identifies state name within a sentence.", () => {
  expect(MessageParserUtil.determineState("I want to vote in North Carolina please")).toBe("North Carolina");
});

test("Identifies state name within a sentence, ignores case and spacing.", () => {
  expect(MessageParserUtil.determineState("I want to vote in noRtHCaRolinA please")).toBe("North Carolina");
});

test("Identifies state name at start of a sentence.", () => {
  expect(MessageParserUtil.determineState("North Carolina please")).toBe("North Carolina");
});

test("Identifies state name at start of a sentence, ignores case and spacing.", () => {
  expect(MessageParserUtil.determineState("noRtHCaRolinA please")).toBe("North Carolina");
});

test("Identifies state name at end of a sentence.", () => {
  expect(MessageParserUtil.determineState("I want to vote in North Carolina")).toBe("North Carolina");
});

test("Identifies state name at end of a sentence, ignores case and spacing.", () => {
  expect(MessageParserUtil.determineState("I want to vote in noRtHCaRolinA")).toBe("North Carolina");
});

test("Handles state name adjacent to punctuation.", () => {
  expect(MessageParserUtil.determineState("I want to vote in NorThCaRolinA..")).toBe("North Carolina");
});

test("Handles abbreviation of only name part.", () => {
  expect(MessageParserUtil.determineState("I want to vote in NCarolina")).toBe("North Carolina");
});

test("Handles abbreviation of only name part, with period.", () => {
  expect(MessageParserUtil.determineState("I want to vote in N.Carolina")).toBe("North Carolina");
});
