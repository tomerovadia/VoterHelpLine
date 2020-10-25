const KeywordParser = require('./keyword_parser');

test('Does not consider a normal message to contain STOP keyword.', () => {
  expect(KeywordParser.isStopKeyword('Some normal message')).toBe(false);
});

test('Detects STOP keyword.', () => {
  expect(KeywordParser.isStopKeyword('STOP')).toBe(true);
});

test('Detects STOP keyword with spaces on either side.', () => {
  expect(KeywordParser.isStopKeyword('  STOP   ')).toBe(true);
});

test('Does not detect STOP keyword with spaces within the word.', () => {
  expect(KeywordParser.isStopKeyword('VOTING IS TOP OF MIND FOR ME YAY')).toBe(
    false
  );
});

test('Detects STOP keyword with punctuation.', () => {
  expect(KeywordParser.isStopKeyword('STOP!')).toBe(true);
});

test('Detects STOP keyword in any upper/lower case.', () => {
  expect(KeywordParser.isStopKeyword('stop')).toBe(true);
  expect(KeywordParser.isStopKeyword('StOp')).toBe(true);
});

test('Detects STOP keyword alone in any upper/lower case even with punctuation.', () => {
  expect(KeywordParser.isStopKeyword('stop!!')).toBe(true);
  expect(KeywordParser.isStopKeyword('Stop!!')).toBe(true);
  expect(KeywordParser.isStopKeyword('S.T.O.P.')).toBe(true);
});

test('Does not detect lowercase stop in the context of a longer message if lowercase.', () => {
  expect(
    KeywordParser.isStopKeyword(
      "I'll stop by the polling place on the way to work"
    )
  ).toBe(false);
});
