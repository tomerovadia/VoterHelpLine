const KeywordParser = require('./keyword_parser');

test('Does not consider a normal message to contain STOP keyword.', () => {
  expect(KeywordParser.containsStopKeyword('Some normal message')).toBe(false);
});

test('Detects STOP keyword.', () => {
    expect(KeywordParser.containsStopKeyword('STOP')).toBe(true);
});

test('Detects STOP keyword with spaces on either side.', () => {
    expect(KeywordParser.containsStopKeyword('  STOP   ')).toBe(true);
});

test('Does not detect STOP keyword with spaces within the word.', () => {
    expect(KeywordParser.containsStopKeyword('VOTING IS TOP OF MIND FOR ME YAY')).toBe(false);
});

test('Detects STOP keyword with punctuation.', () => {
    expect(KeywordParser.containsStopKeyword('STOP!')).toBe(true);
});

test('Detects STOP keyword in any upper/lower case.', () => {
    expect(KeywordParser.containsStopKeyword('stop')).toBe(true);
    expect(KeywordParser.containsStopKeyword('StOp')).toBe(true);
});

test('Detects STOP keyword alone in any upper/lower case even with punctuation.', () => {
    expect(KeywordParser.containsStopKeyword('stop!!')).toBe(true);
});

test('Does not detect lowercase stop in the context of a longer message if lowercase.', () => {
    expect(KeywordParser.containsStopKeyword("I'll stop by the polling place on the way to work")).toBe(false);
});

test('Detects STOP keyword in the context of longer message if in all uppercase.', () => {
    expect(KeywordParser.containsStopKeyword("That's what I am telling you, I have done what you told me to do to unsubscribe and YOU ARE STILL CONTACTING ME. STOP IT!!")).toBe(true);
});