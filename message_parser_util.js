const stateConstants = require('./state_constants');

exports.determineState = (userMessage) => {
  for (key in stateConstants) {
    const abbrev = key;
    const stateName = stateConstants[key];
    const userMessageNoPunctuation = userMessage.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');

    const stateWords = stateName.split(" ");
    let nameRegEx = null;
    let abbrevNameRegEx = null;

    // If the state name has two words, match against that name whether or not
    // there is a space between the words (e.g. northcarolina), and also match
    // against the first letter abbreviated (n. carolina).
    if (stateWords.length > 1) {
      const firstWord = stateWords[0];
      const firstLetter = firstWord[0];
      const secondWord = stateWords[1];

      abbrevNameRegEx = new RegExp(`${firstLetter}\\s*${secondWord}`, 'i');
      nameRegEx = new RegExp(`${firstWord}\\s*${secondWord}`, 'i');
    } else {
      nameRegEx = new RegExp(stateName, 'i');
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

    const abbrevMatch = abbrevRegEx.test(userMessageNoPunctuation) ||
                         abbrevExactRegEx.test(userMessageNoPunctuation);

    const nameMatch = nameRegEx.test(userMessageNoPunctuation);

    // For abbreviated names (e.g. n.carolina).
    const abbrevNameMatch = abbrevNameRegEx ? abbrevNameRegEx.test(userMessageNoPunctuation) : false;

    if (abbrevMatch || nameMatch || abbrevNameMatch) {
      return stateName;
    }
  }

  return null;
}
