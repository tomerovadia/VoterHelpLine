const LoadBalancer = require('./load_balancer');

describe('convertSlackChannelNameToStateOrRegionName', () => {
  test('Removes pod number and capitalizes U.S. state name.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(`texas-0`)
    ).toBe('Texas');
  });

  test('Removes pod number, capitalizes U.S. state name and adds space if two-word.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(
        `north-carolina-0`
      )
    ).toBe('North Carolina');
  });

  test('Removes pod number, capitalizes U.S. state name and adds space if three-word.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(
        `district-of-columbia-0`
      )
    ).toBe('District of Columbia');
  });

  test('Removes pod number, capitalizes region and adds space even if two-word.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(`eastern-north-7`)
    ).toBe('Eastern North');
  });

  test('Removes pod number, capitalizes region and adds space even if multi-word.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(`in-nh-vt-7`)
    ).toBe('In Nh Vt');
  });

  test('Handles large pod numbers.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(`florida-100`)
    ).toBe('Florida');
  });

  test('Handles demo channels.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(
        `demo-florida-100`
      )
    ).toBe('Florida');
  });

  test('Handles national channels.', () => {
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(`demo-national-0`)
    ).toBe('National');
    expect(
      LoadBalancer.convertSlackChannelNameToStateOrRegionName(`national-0`)
    ).toBe('National');
  });
});
