const StateParser = require('./state_parser');

test('Identifies exact state abbreviation.', () => {
  expect(StateParser.determineState('NC')).toBe('North Carolina');
});

test('Ignores case for exact state abbreviation.', () => {
  expect(StateParser.determineState('nc')).toBe('North Carolina');
});

test('Ignores case for exact state abbreviation.', () => {
  expect(StateParser.determineState('n.C.')).toBe('North Carolina');
});

test('Identifies exact state abbreviation w/periods.', () => {
  expect(StateParser.determineState('F.L.')).toBe('Florida');
});

test('Ignores case for exact state abbreviation w/periods.', () => {
  expect(StateParser.determineState('f.L.')).toBe('Florida');
});

test('Identifies state abbreviation within a sentence.', () => {
  expect(StateParser.determineState('I want to vote in NC please')).toBe(
    'North Carolina'
  );
});

test('Identifies state abbreviation within a sentence, ignores case and periods.', () => {
  expect(StateParser.determineState('I want to vote in f.L. please')).toBe(
    'Florida'
  );
});

test('Identifies state abbreviation at start of a sentence.', () => {
  expect(StateParser.determineState('FL please')).toBe('Florida');
});

test('Identifies state abbreviation at start of a sentence, ignores case and spacing.', () => {
  expect(StateParser.determineState('N.c. please')).toBe('North Carolina');
});

test('Identifies state abbreviation at end of a sentence.', () => {
  expect(StateParser.determineState('I want to vote in FL.')).toBe('Florida');
});

test('Identifies state abbreviation at end of a sentence, ignores case and spacing.', () => {
  expect(StateParser.determineState('I want to vote in N.c...')).toBe(
    'North Carolina'
  );
});

test('Returns null for message without state intent.', () => {
  // "wi" is inside of "with"
  expect(StateParser.determineState("I'm not sure.")).toBe(null);
});

test('Does not interpret parts of words as state abbreviation intent.', () => {
  // "wi" is inside of "with"
  expect(StateParser.determineState('I need help with voting')).toBe(null);
  // "nc" is inside of "once"
  expect(StateParser.determineState('How do I vote once I register')).toBe(
    null
  );
});

test('Filters inconsistent punctuation around state abbreviations.', () => {
  expect(StateParser.determineState('fl.')).toBe('Florida');
  expect(StateParser.determineState('Nc.')).toBe('North Carolina');
  expect(StateParser.determineState('f.l')).toBe('Florida');
  expect(StateParser.determineState('fl..')).toBe('Florida');
});

test('Identifies exact state name.', () => {
  expect(StateParser.determineState('North Carolina')).toBe('North Carolina');
});

test('Ignores case in exact state name.', () => {
  expect(StateParser.determineState('noRtH CaRolinA')).toBe('North Carolina');
});

test('Ignores case in exact state name.', () => {
  expect(StateParser.determineState('noRtH CaRolinA')).toBe('North Carolina');
});

test('Identifies state name with missing space.', () => {
  expect(StateParser.determineState('noRtHCaRolinA')).toBe('North Carolina');
});

test('Identifies state name within a sentence.', () => {
  expect(
    StateParser.determineState('I want to vote in North Carolina please')
  ).toBe('North Carolina');
});

test('Identifies state name within a sentence, ignores case and spacing.', () => {
  expect(
    StateParser.determineState('I want to vote in noRtHCaRolinA please')
  ).toBe('North Carolina');
});

test('Identifies state name at start of a sentence.', () => {
  expect(StateParser.determineState('North Carolina please')).toBe(
    'North Carolina'
  );
});

test('Identifies state name at start of a sentence, ignores case and spacing.', () => {
  expect(StateParser.determineState('noRtHCaRolinA please')).toBe(
    'North Carolina'
  );
});

test('Identifies state name at end of a sentence.', () => {
  expect(StateParser.determineState('I want to vote in North Carolina')).toBe(
    'North Carolina'
  );
});

test('Identifies state name at end of a sentence, ignores case and spacing.', () => {
  expect(StateParser.determineState('I want to vote in noRtHCaRolinA')).toBe(
    'North Carolina'
  );
});

test('Handles state name adjacent to punctuation.', () => {
  expect(StateParser.determineState('I want to vote in NorThCaRolinA..')).toBe(
    'North Carolina'
  );
});

test('Handles abbreviation of only name part.', () => {
  expect(StateParser.determineState('I want to vote in NCarolina')).toBe(
    'North Carolina'
  );
});

test('Handles abbreviation of only name part, with period.', () => {
  expect(StateParser.determineState('I want to vote in N.Carolina')).toBe(
    'North Carolina'
  );
});
