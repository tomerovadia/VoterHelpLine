import { getStateConstants } from './state_constants';

export function determineState(userMessage: string): string | null {
  const stateConstants = getStateConstants();
  for (const key in stateConstants) {
    const abbrev = key;
    const stateName = stateConstants[key];
    const userMessageNoPunctuation = userMessage.replace(
      /[.,?/#!$%^&*;:{}=\-_`~()]/g,
      ''
    );

    const stateWords = stateName.split(' ');
    let nameRegEx = null;
    let abbrevNameRegEx = null;

    // If the state name has two words, match against that name whether or not
    // there is a space between the words (e.g. northcarolina), and also match
    // against the first letter abbreviated (n. carolina).
    if (stateWords.length === 2) {
      const firstWord = stateWords[0];
      const firstLetter = firstWord[0];
      const secondWord = stateWords[1];

      abbrevNameRegEx = new RegExp(`${firstLetter}\\s*${secondWord}`, 'i');
      nameRegEx = new RegExp(`${firstWord}\\s*${secondWord}`, 'i');
    // Only applies to District of Columbia
    } else if (stateWords.length === 3) {
      nameRegEx = new RegExp(`${stateWords[0]}\\s*${stateWords[1]}\\s*${stateWords[2]}`, 'i');
    } else {
      nameRegEx = new RegExp(stateName, 'i');
    }

    const nameMatch = nameRegEx.test(userMessageNoPunctuation);

    // For abbreviated names (e.g. n.carolina).
    const abbrevNameMatch = abbrevNameRegEx
      ? abbrevNameRegEx.test(userMessageNoPunctuation)
      : false;

    if (nameMatch || abbrevNameMatch) {
      return stateName;
    }

    // Handle IN, OK, ME, OR and HI as special edge cases given they are common English words.
    // Err on the side of NOT recognizing a U.S. state selection so that admins can correct
    // instead of incorrectly recognizing a U.S. state, which calls for an apology.
    // Require that for these states, the U.S. state abbreviation NOT be in the context
    // of a longer message (e.g. "I hope my ballot is O.K." != Oklahoma).
    // Note: This check occurs if a state name isn't found and before a state abbreviation is
    // sought.
    if (['IN', 'OK', 'ME', 'OR', 'HI'].includes(abbrev)) {
      // Remove spaces in case message is state abbreviation plus spaces and punctuation (e.g. "O.K. ")
      const userMessageNoPunctuationOrSpaces = userMessageNoPunctuation.replace(
        /\s/g,
        ''
      );
      if (userMessageNoPunctuationOrSpaces.length > 2) {
        continue;
      }
    }

    // Look for abbreviations differently than names, because they are more
    // likely to be part of unrelated words (e.g. "wi" for Wisconsin in "with").
    // Look for abbreviations to:
    //    1) be an exact full match ("WI"),
    const abbrevExactRegEx = new RegExp(`^${abbrev}$`, 'i');
    //    2) match the beginning and have a space after ("WI please"),
    //    3) match the end and have a space before ("ok WI"), or
    //    4) match in the middle and have a space both before and after ("ok WI please").
    const abbrevRegEx = new RegExp(`(\\s|^)${abbrev}(\\s|$)`, 'i');

    const abbrevMatch =
      abbrevRegEx.test(userMessageNoPunctuation) ||
      abbrevExactRegEx.test(userMessageNoPunctuation);

    if (abbrevMatch) {
      return stateName;
    }
  }

  return null;
}
