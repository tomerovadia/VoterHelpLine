export function getStateConstants(): { [stateCode: string]: string } {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return {
        AL: 'Alabama',
        AK: 'Alaska',
        AZ: 'Arizona',
        AR: 'Arkansas',
        CA: 'California',
        CO: 'Colorado',
        CT: 'Connecticut',
        DE: 'Delaware',
        DC: 'District of Columbia',
        FL: 'Florida',
        GA: 'Georgia',
        HI: 'Hawaii',
        ID: 'Idaho',
        IL: 'Illinois',
        IA: 'Iowa',
        KS: 'Kansas',
        KY: 'Kentucky',
        LA: 'Louisiana',
        MD: 'Maryland',
        MA: 'Massachusetts',
        MI: 'Michigan',
        MN: 'Minnesota',
        MS: 'Mississippi',
        MO: 'Missouri',
        MT: 'Montana',
        NE: 'Nebraska',
        NV: 'Nevada',
        NH: 'New Hampshire',
        NJ: 'New Jersey',
        NM: 'New Mexico',
        NY: 'New York',
        NC: 'North Carolina',
        ND: 'North Dakota',
        OH: 'Ohio',
        PA: 'Pennsylvania',
        RI: 'Rhode Island',
        SC: 'South Carolina',
        SD: 'South Dakota',
        TN: 'Tennessee',
        TX: 'Texas',
        UT: 'Utah',
        VT: 'Vermont',
        WV: 'West Virginia',
        VA: 'Virginia',
        WA: 'Washington',
        WI: 'Wisconsin',
        WY: 'Wyoming',
        IN: 'Indiana',
        OK: 'Oklahoma',
        ME: 'Maine',
        OR: 'Oregon',
      };
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
    case 'GADEMS':
      return {
        GA: 'Georgia',
      };
    default:
      return {
        NC: 'North Carolina',
        FL: 'Florida',
        OH: 'Ohio',
      };
  }
}
