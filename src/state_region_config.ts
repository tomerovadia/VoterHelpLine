import { difference, uniq } from 'lodash';
import { getStateConstants } from './state_constants';

export const stateToRegionMap: { [stateCode: string]: string } = {
  Alabama: 'Central',
  Alaska: 'Pacific',
  Arizona: 'Arizona',
  Arkansas: 'Central',
  California: 'California',
  Colorado: 'Colorado',
  Connecticut: 'Eastern North',
  Delaware: 'Eastern North',
  'District of Columbia': 'Eastern South',
  Florida: 'Florida',
  Georgia: 'Georgia',
  Hawaii: 'Pacific',
  Idaho: 'Mountain',
  Illinois: 'Illinois',
  Indiana: 'Eastern North',
  Iowa: 'Central',
  Kansas: 'Central',
  Kentucky: 'Eastern South',
  Louisiana: 'Central',
  Maine: 'Eastern North',
  Maryland: 'Eastern South',
  Massachusetts: 'Eastern North',
  Michigan: 'Eastern North',
  Minnesota: 'Minnesota',
  Mississippi: 'Central',
  Missouri: 'Central',
  Montana: 'Mountain',
  Nebraska: 'Central',
  Nevada: 'Pacific',
  'New Hampshire': 'Eastern North',
  'New Jersey': 'Eastern North',
  'New Mexico': 'Mountain',
  'New York': 'New York',
  'North Carolina': 'North Carolina',
  'North Dakota': 'Central',
  Ohio: 'Eastern North',
  Oklahoma: 'Central',
  Oregon: 'Pacific',
  Pennsylvania: 'Pennsylvania',
  'Rhode Island': 'Eastern North',
  'South Carolina': 'Eastern South',
  'South Dakota': 'Central',
  Tennessee: 'Eastern South',
  Texas: 'Texas',
  Utah: 'Mountain',
  Vermont: 'Eastern North',
  Virginia: 'Eastern South',
  Washington: 'Pacific',
  'West Virginia': 'Eastern South',
  Wisconsin: 'Wisconsin',
  Wyoming: 'Mountain',
  National: 'National',
};

export const regionsList =
  process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA'
    ? uniq(Object.values(stateToRegionMap))
    : [];

export const regionsListMinusStates = difference(
  regionsList,
  Object.values(getStateConstants())
);
