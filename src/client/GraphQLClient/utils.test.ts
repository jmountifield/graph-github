import utils from './utils';

describe('utils', () => {
  test('hasProperties', () => {
    expect(utils.hasProperties(null)).toBeFalsy();
    expect(utils.hasProperties(undefined)).toBeFalsy();
    expect(utils.hasProperties({})).toBeFalsy();
    expect(utils.hasProperties(new Object())).toBeFalsy();
    expect(utils.hasProperties({ dog: 'dog' })).toBeTruthy();
  });
  test('innerResourcePaginationRequired', () => {
    expect(utils.innerResourcePaginationRequired(null)).toBeFalsy();
    expect(utils.innerResourcePaginationRequired(undefined)).toBeFalsy();
    expect(utils.innerResourcePaginationRequired({})).toBeFalsy();
    expect(
      utils.innerResourcePaginationRequired({
        commits: { pageInfo: { hasNextPage: true } },
      }),
    ).toBeTruthy();
    expect(utils.innerResourcePaginationRequired({ commits: {} })).toBeFalsy();
    expect(
      utils.innerResourcePaginationRequired({
        labels: { pageInfo: { hasNextPage: true } },
        commits: { pageInfo: {} },
        reviews: {},
      }),
    ).toBeTruthy();
    expect(
      utils.innerResourcePaginationRequired({
        labels: undefined,
        commits: null,
        reviews: { pageInfo: { hasNextPage: true } },
      }),
    ).toBeTruthy();
  });

  test('responseToResource', () => {
    expect(
      utils.responseToResource({
        id: 'PR_asdf',
        commits: {
          totalCount: 11,
          nodes: [null, null, null, null, null, { commit: { asdf: 'commit' } }],
          pageInfo: {
            endCursor: 'MTE',
            hasNextPage: false,
          },
        },
        reviews: {
          totalCount: 117,
          nodes: [
            null,
            undefined,
            {
              id: 'asdf',
              commit: null,
              author: {},
              state: 'COMMENTED',
              submittedAt: '2000-04-19T04:33:08Z',
              updatedAt: '2000-04-19T04:33:08Z',
              url: 'https://github.com/',
            },
          ],
          pageInfo: {
            endCursor: 'asdf333',
            hasNextPage: true,
          },
        },
        labels: {
          totalCount: 2,
          nodes: [null, { asdf: 'label' }],
          pageInfo: {
            endCursor: null,
            hasNextPage: false,
          },
        },
      }),
    ).toMatchSnapshot();
  });
});
