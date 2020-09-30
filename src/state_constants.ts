export function getStateConstants(): { [stateCode: string]: string } {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return {
        NC: 'North Carolina',
        FL: 'Florida',
        OH: 'Ohio',
      };
    case 'VOTE_FROM_HOME_2020':
      return {
        MI: 'Michigan',
        NC: 'North Carolina',
        PA: 'Pennsylvania',
      };
    default:
      return {
        NC: 'North Carolina',
        FL: 'Florida',
        OH: 'Ohio',
      };
  }
}
