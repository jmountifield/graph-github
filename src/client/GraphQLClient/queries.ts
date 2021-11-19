/**
 * GraphQL queries used for various resource requests
 *
 * Note that the spread-like syntax below ultimately references fragments.ts via a function
 * built-in to graphql.js. (For another example of how that works, see
 * https://www.apollographql.com/docs/react/data/fragments/ ).
 *
 * The actual GraphQL query that hits the API will have substituted in the parameters
 * and expanded the fragments.
 *
 * Note that if a GraphQL query pulls too much data, it will throw an error. This is especially
 * likely in cases where there are many nested objects, such as TEAM_REPOS_QUERY_STRING below,
 * where the query requests every repo assigned to every team. In such cases, the pagination
 * can be altered by changing the "first" parameter. We have often done this from 100 to 25 in
 * cases where we are concerned about large data returns.
 *
 */

export const MAX_REQUESTS_NUM = 1;
export const LIMITED_REQUESTS_NUM = 1; //this is sometimes used to avoid errors

export const ACCOUNT_QUERY_STRING = `query ($login: String!) {
    organization(login: $login) {
        id
        ...organizationFields
      }
...rateLimit
  }`;

export const REPOS_QUERY_STRING = `query ($login: String!, $repositories: String) {
      organization(login: $login) {
          id
          repositories(first: ${MAX_REQUESTS_NUM}, after: $repositories) {
          edges {
            node {
              id
              ...repositoryFields
            }
          }
          pageInfo {
    endCursor
    hasNextPage
  }
        }
        }
  ...rateLimit
    }`;

export const USERS_QUERY_STRING = `query ($login: String!, $membersWithRole: String) {
    organization(login: $login) {
        id
        membersWithRole(first: ${MAX_REQUESTS_NUM}, after: $membersWithRole) {
        edges {
          node {
            id
            ...userFields
          }
          ...userEdgeFields
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
      }
...rateLimit
  }`;

export const TEAMS_QUERY_STRING = `query ($login: String!, $teams: String) {
    organization(login: $login) {
        id
        teams(first: ${MAX_REQUESTS_NUM}, after: $teams) {
        edges {
          node {
            id
            ...teamFields
          }
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
      }
...rateLimit
  }`;

export const TEAM_MEMBERS_QUERY_STRING = `query ($login: String!, $teams: String, $members: String) {
    organization(login: $login) {
        id
        teams(first: ${MAX_REQUESTS_NUM}, after: $teams) {
        edges {
          node {
            id
            members(first: ${MAX_REQUESTS_NUM}, after: $members) {
        edges {
          node {
            id
            ...teamMemberFields
          }
          ...teamMemberEdgeFields
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
          }
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
      }
...rateLimit
  }`;

export const TEAM_REPOS_QUERY_STRING = `query ($login: String!, $teams: String, $teamRepositories: String) {
    organization(login: $login) {
        id
        teams(first: ${LIMITED_REQUESTS_NUM}, after: $teams) {
        edges {
          node {
            id
            repositories(first: ${LIMITED_REQUESTS_NUM}, after: $teamRepositories) {
        edges {
          node {
            id
          }
          ...teamRepositoryEdgeFields
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
          }
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
      }
...rateLimit
  }`;

export const ISSUES_QUERY_STRING = `query ($query: String!, $issues: String, $assignees: String, $labels: String) {
    search(first: ${LIMITED_REQUESTS_NUM}, after: $issues, type: ISSUE, query: $query) {
        issueCount
        edges {
          node {
            ...issueFields
            ... on Issue {
          assignees(first: ${MAX_REQUESTS_NUM}, after: $assignees) {
          totalCount
          edges {
            node {
              name
              login
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
... on Issue {
          labels(first: ${MAX_REQUESTS_NUM}, after: $labels) {
          totalCount
          edges {
            node {
              id
              name
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
          }
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
...rateLimit
  }`;

export const PULL_REQUESTS_QUERY_STRING = `query ($query: String!, $pullRequests: String, $commits: String, $reviews: String, $labels: String) {
    search(first: ${LIMITED_REQUESTS_NUM}, after: $pullRequests, type: ISSUE, query: $query) {
        issueCount
        edges {
          node {
            ...pullRequestFields
            ... on PullRequest {
        commits(first: ${MAX_REQUESTS_NUM}, after: $commits) {
          totalCount
          edges {
            node {
              commit {
                ...commitFields
              }
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
... on PullRequest {
        reviews(first: ${MAX_REQUESTS_NUM}, after: $reviews) {
          totalCount
          edges {
            node {
              ...reviewFields
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
... on PullRequest {
          labels(first: ${MAX_REQUESTS_NUM}, after: $labels) {
          totalCount
          edges {
            node {
              id
              name
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
          }
        }
        pageInfo {
  endCursor
  hasNextPage
}
      }
...rateLimit
  }`;

export const SINGLE_PULL_REQUEST_QUERY_STRING = `query ($pullRequestNumber: Int!, $repoName: String!, $repoOwner: String!, $commits: String, $reviews: String, $labels: String) {
    repository(name: $repoName, owner: $repoOwner) {
          pullRequest(number: $pullRequestNumber) {
            ...pullRequestFields
            ... on PullRequest {
        commits(first: ${MAX_REQUESTS_NUM}, after: $commits) {
          totalCount
          edges {
            node {
              commit {
                ...commitFields
              }
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
... on PullRequest {
        reviews(first: ${MAX_REQUESTS_NUM}, after: $reviews) {
          totalCount
          edges {
            node {
              ...reviewFields
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
... on PullRequest {
          labels(first: ${MAX_REQUESTS_NUM}, after: $labels) {
          totalCount
          edges {
            node {
              id
              name
            }
          }
          pageInfo {
  endCursor
  hasNextPage
}
        }
      }
          }
      }
...rateLimit
  }`;

export const COLLABORATORS_QUERY_STRING = `query ($login: String!, $repositories: String, $collaborators: String) {
  organization(login: $login) {
      id
      repositories(first: ${LIMITED_REQUESTS_NUM}, after: $repositories) {
      edges {
        node {
          id
          collaborators(first: ${LIMITED_REQUESTS_NUM}, after: $collaborators) {
      edges {
        node {
          id
          name
          login
        }
        permission
      }
      pageInfo {
endCursor
hasNextPage
}
    }
        }
      }
      pageInfo {
endCursor
hasNextPage
}
    }
    }
...rateLimit
}`;
