const StateParser = require('./state_parser');

beforeEach(() => {
  process.env.CLIENT_ORGANIZATION = 'VOTE_AMERICA';
});

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

test('Does not consider abbreviations for District of Columbia.', () => {
  expect(
    // Contains "d of" in "instead of a ballot"
    StateParser.determineState('i received an application today instead of a ballot')
  ).toBe(null);
});

test('If a U.S. state name is within another U.S. state name, prioritize the full name.', () => {
  expect(
    // "West Virginia" contains "Virginia"
    StateParser.determineState('West Virginia')
  ).toBe('West Virginia');
});

test('Adds extra scrutiny to "in", "me", "ok", "or" and "hi", not considering them to be U.S. state mentions in the context of longer messages', () => {
  expect(StateParser.determineState('Mail-in ballot')).toBe(null);

  expect(
    StateParser.determineState(
      'Either send me the form, or remove from your mailing list.'
    )
  ).toBe(null);

  expect(
    StateParser.determineState('I need to make sure that my ballot is ok')
  ).toBe(null);

  expect(StateParser.determineState('Hi can you help me vote?')).toBe(null);

  expect(StateParser.determineState('Can you help me vote?')).toBe(null);
});

test('Does recognize "in", "ok", "me", "or" and "hi" as U.S. state preferences when alone in a message, excluding spaces', () => {
  expect(StateParser.determineState('in ')).toBe('Indiana');

  expect(StateParser.determineState('O.K. ')).toBe('Oklahoma');

  expect(StateParser.determineState(' ME ')).toBe('Maine');

  expect(StateParser.determineState(' Or    ')).toBe('Oregon');

  expect(StateParser.determineState('Hi    ')).toBe('Hawaii');
});

test('Does recognize "Indiana", "Oklahoma", "Maine", "Oregon" and "Hawaii" normally, even in the context of a longer message', () => {
  expect(StateParser.determineState('Send me to Oklahoma')).toBe('Oklahoma');

  expect(StateParser.determineState("I'm in Maine")).toBe('Maine');

  expect(StateParser.determineState("Ok let's do Indiana")).toBe('Indiana');

  expect(StateParser.determineState('Ok Oregon')).toBe('Oregon');

  expect(StateParser.determineState('Hi I need help with Hawaii please')).toBe(
    'Hawaii'
  );
});
