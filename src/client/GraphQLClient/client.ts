import graphql, { GraphQLClient } from 'graphql.js';
import { get } from 'lodash';
import { URL } from 'url';

import {
  IntegrationLogger,
  IntegrationProviderAPIError,
  IntegrationProviderAuthenticationError,
  parseTimePropertyValue,
} from '@jupiterone/integration-sdk-core';
import { AttemptContext, retry } from '@lifeomic/attempt';
import { Octokit } from '@octokit/rest';

import { ResourceIteratee } from '../../client';
import sleepIfApproachingRateLimit from '../../util/sleepIfApproachingRateLimit';
import validateGraphQLResponse from '../../util/validateGraphQLReponse';
import fragments from './fragments';
import {
  LIMITED_REQUESTS_NUM,
  SINGLE_PULL_REQUEST_QUERY_STRING,
} from './queries';
import {
  responseHasNextPage,
  processGraphQlPageResult,
  mapResponseCursorsForQuery,
} from './response';
import {
  CursorHierarchy,
  GithubQueryResponse as QueryResponse,
  GithubResource,
  Issue,
  Node,
  PullRequest,
  ResourceMap,
  ResourceMetadata,
} from './types';
import PullRequestsQuery from './pullRequestQueries/PullRequestsQuery';
import { createQueryExecutor } from './CreateQueryExecutor';

const FIVE_MINUTES_IN_SECS = 300000;

export class GitHubGraphQLClient {
  private readonly graphqlUrl: string;

  /**
   * A function generated by `graphql()` that is bound to authentication
   * parameters. Changes to auth require regenerating the function.
   *
   * @throws GraphQLError, which you can read about at
   * https://github.com/f/graphql.js/blob/4d3c2eb726e711baf58f45c613ebfd5c34c55218/graphql.js#L325
   *
   * Forms of the error we've seen:
   * - The complete response object is rejected on a non-200 response:
   *   { "data": null, "errors": [{ "message": string }]} }
   * - Only the "errors" array is rejected on a `200` response:
   *   [{
   *      "type": "FORBIDDEN",
   *      "path": ["search","edges",6,"node","mergeCommit"],
   *      "extensions": { "saml_failure": false },
   *      "locations": [
   *        {
   *          "line": 143,
   *          "column": 5
   *        }
   *      ],
   *      "message": "Resource not accessible by integration"
   *    },
   *    ...
   *  ]
   */
  private graph: GraphQLClient;

  private resourceMetadataMap: ResourceMap<ResourceMetadata>;
  private logger: IntegrationLogger;
  private authClient: Octokit;
  private tokenExpires: number;

  constructor(
    graphqlUrl: string,
    token: string,
    tokenExpires: number,
    resourceMetadataMap: ResourceMap<ResourceMetadata>,
    logger: IntegrationLogger,
    authClient: Octokit,
  ) {
    this.graphqlUrl = graphqlUrl;
    this.graph = graphql(this.graphqlUrl, {
      headers: {
        'User-Agent': 'jupiterone-graph-github',
        Authorization: `token ${token}`,
      },
      asJSON: true,
    });
    this.graph.fragment(fragments);
    this.tokenExpires = tokenExpires;
    this.resourceMetadataMap = resourceMetadataMap;
    this.logger = logger;
    this.authClient = authClient;
  }

  private async refreshToken() {
    try {
      const { token, expiresAt } = (await this.authClient.auth({
        type: 'installation',
        refresh: true, //required or else client will return the previous token from cache
      })) as {
        token: string;
        expiresAt: string;
      };
      this.graph = graphql(this.graphqlUrl, {
        headers: {
          'User-Agent': 'jupiterone-graph-github',
          Authorization: `token ${token}`,
        },
        asJSON: true,
      });
      this.graph.fragment(fragments);
      this.tokenExpires = parseTimePropertyValue(expiresAt) || 0;
    } catch (err) {
      throw new IntegrationProviderAuthenticationError({
        cause: err,
        endpoint: `${this.graphqlUrl}/app/installations/\${installationId}/access_tokens`,
        status: err.status,
        statusText: err.statusText,
      });
    }
  }

  public async iteratePullRequestsV2(
    repository: { fullName: string; public: boolean },
    lastExecutionTime: string,
    iteratee: ResourceIteratee<PullRequest>,
  ): Promise<QueryResponse> {
    const executor = createQueryExecutor(this, this.logger);

    const { rateLimitConsumed } = await PullRequestsQuery.iteratePullRequests(
      repository,
      lastExecutionTime,
      iteratee,
      executor,
    );

    return {
      rateLimitConsumed,
    };
  }

  /**
   * Performs GraphQl request.
   * Handles:
   *    - token management (refreshes 5 minutes before expiring)
   *    - rate limit management
   * @param queryString
   * @param queryVariables
   */
  public async query(queryString: string, queryVariables) {
    if (this.tokenExpires - FIVE_MINUTES_IN_SECS < Date.now()) {
      await this.refreshToken();
    }
    return await this.retryGraphQLV2(queryString, queryVariables);
  }

  /**
   * @Deprecated use iteratePullRequestsV2
   * Iterates through a search request for Pull Requests while handling
   * pagination of both the pull requests and their inner resources.
   *
   * @param prGraphQLQueryString The pull requests GraphQL query string
   * @param issuesSearchQuery The Github Issue search query with syntax - https://docs.github.com/en/github/searching-for-information-on-github/searching-on-github/searching-issues-and-pull-requests
   * @param selectedResources - The sub-objects to additionally query for. Ex: [commits]
   * @param iteratee - a callback function for each PullRequest
   */
  public async iteratePullRequests(
    prGraphQLQueryString: string,
    issuesSearchQuery: string,
    selectedResources: GithubResource[],
    iteratee: ResourceIteratee<PullRequest>,
    limit: number = 500, // requests PRs since last execution time, or upto this limit, whichever is less
  ): Promise<QueryResponse> {
    let queryCursors: ResourceMap<CursorHierarchy> = {};
    let rateLimitConsumed = 0;
    let pullRequestsQueried = 0;
    let hasMorePullRequests = false;

    let queryPullRequests = this.graph(prGraphQLQueryString);

    do {
      if (this.tokenExpires - 300000 < Date.now()) {
        //300000 msec = 5 min
        //token expires soon; we'd rather refresh proactively
        await this.refreshToken();
        queryPullRequests = this.graph(prGraphQLQueryString);
      }
      this.logger.info(
        { issuesSearchQuery, queryCursors },
        'Fetching batch of pull requests from GraphQL',
      );
      let pullRequestResponse;
      try {
        pullRequestResponse = await this.retryGraphQL(
          prGraphQLQueryString,
          async () => {
            return await queryPullRequests({
              query: issuesSearchQuery,
              ...queryCursors,
            });
          },
        );
      } catch (err) {
        if (err.status === 401) {
          // why isn't this being handled inside of .retryGraphQL above?
          // because we need to generate the function queryPullRequests from the graph function
          // of the GraphQL client, and the token in the GraphQL client at the time of
          // invoking this.graph(queryString) gets embedded in the returned function
          // therefore, we can't change tokens without recreating the queryPullRequests function,
          // which means we have to re-invoke the retry function
          await this.refreshToken();
          queryPullRequests = this.graph(prGraphQLQueryString);
          pullRequestResponse = await this.retryGraphQL(
            prGraphQLQueryString,
            async () => {
              return await queryPullRequests({
                query: issuesSearchQuery,
                ...queryCursors,
              });
            },
          );
        } else {
          throw err;
        }
      }
      pullRequestsQueried += LIMITED_REQUESTS_NUM;
      const rateLimit = pullRequestResponse.rateLimit;
      this.logger.info({ rateLimit }, 'Rate limit info for iteration');
      rateLimitConsumed += rateLimit?.cost ?? 0;
      await sleepIfApproachingRateLimit(
        pullRequestResponse.rateLimit,
        this.logger,
      );

      this.logger.info(
        {
          issuesSearchQuery,
          numPullRequests: pullRequestResponse.search.edges.length,
        },
        'Found pull requests for repo',
      );

      for (const pullRequestQueryData of pullRequestResponse.search.edges) {
        const { resources: pageResources, cursors: innerResourceCursors } =
          processGraphQlPageResult(
            selectedResources,
            this.resourceMetadataMap,
            pullRequestQueryData.node,
            GithubResource.PullRequests,
          );

        // Construct the pull request
        const pullRequestResponse: PullRequest = {
          ...pageResources.pullRequests[0], // There will only be one PR because of the for loop
          commits: (pageResources.commits ?? []).map((c) => c.commit),
          reviews: pageResources.reviews ?? [],
          labels: pageResources.labels ?? [],
        };

        // This indicates that we were not able to fetch all commits, reviews, etc for this PR
        // in the page of PRs, because some inner resource (eg. commit or review) had more than
        // the limit number of entries (typically) 100. In that case, we have to go make a
        // seperate API call for just that one PR so we can gather up all the inner resources
        // before continuing on to process more PRs. This should be rare.
        if (Object.values(innerResourceCursors).some((c) => c.hasNextPage)) {
          this.logger.info(
            {
              pageCursors: innerResourceCursors,
              pullRequest: pullRequestResponse.title,
            },
            'More inner resources than fit in one page. Attempting to fetch more. (This should be rare).',
          );

          const urlPath = pullRequestResponse.url // ex: https://github.com/JupiterOne/graph-github/pull/1
            ? new URL(pullRequestResponse.url)?.pathname // ex: /JupiterOne/graph-github/pull/4"
            : '';

          // Attempt to pull repo name and owner from graphQL response. If not there, parse the pull request url.
          const repoOwner =
            pullRequestResponse.headRepository?.owner?.login ??
            urlPath.split('/')[1]; // ex: JupiterOne
          const repoName =
            pullRequestResponse.headRepository?.name ?? urlPath.split('/')[2]; // ex: graph-github

          if (!(repoOwner && repoName)) {
            this.logger.warn(
              { pullRequest: pullRequestResponse.title },
              'Unable to fetch all inner resources for this pull request. The owner ' +
                'and repo name could not be determined from the GraphQL response.',
            );
          } else {
            // Fetch the remaining inner resources on this PR (this should be rare)
            const innerResourceResponse = await this.fetchFromSingle(
              SINGLE_PULL_REQUEST_QUERY_STRING,
              GithubResource.PullRequest,
              selectedResources,
              {
                pullRequestNumber: pullRequestResponse.number,
                repoName,
                repoOwner,
              },
              mapResponseCursorsForQuery(innerResourceCursors),
            );

            rateLimitConsumed += innerResourceResponse.rateLimitConsumed;

            // Add the additional inner resources to the initial call
            pullRequestResponse.commits = pullRequestResponse.commits!.concat(
              (innerResourceResponse.commits ?? []).map((c) => c.commit),
            );
            pullRequestResponse.reviews = pullRequestResponse.reviews!.concat(
              innerResourceResponse.reviews ?? [],
            );
            pullRequestResponse.labels = pullRequestResponse.labels!.concat(
              innerResourceResponse.labels ?? [],
            );
          }
        }
        await iteratee(pullRequestResponse);
      }

      hasMorePullRequests =
        pullRequestResponse.search.pageInfo &&
        pullRequestResponse.search.pageInfo.hasNextPage;

      // Check to see if we have iterated through every PR yet. We do not need to care about inner resources at this point.
      queryCursors = hasMorePullRequests
        ? {
            [GithubResource.PullRequests]:
              pullRequestResponse.search.pageInfo.endCursor,
          }
        : {};
    } while (hasMorePullRequests && pullRequestsQueried < limit);

    return {
      rateLimitConsumed,
    };
  }

  /**
   * Iterates through a search request for Issues while handling
   * pagination of both the issues and their inner resources.
   *
   * @param query The Github Issue search query with syntax - https://docs.github.com/en/github/searching-for-information-on-github/searching-on-github/searching-issues-and-pull-requests
   * @param selectedResources - The sub-objects to additionally query for. Ex: [assignees]
   * @param iteratee - a callback function for each Issue
   */
  public async iterateIssues(
    issueQueryString: string,
    query: string,
    selectedResources: GithubResource[],
    iteratee: ResourceIteratee<Issue>,
    limit: number = 500, // requests issues since last execution time, or upto this limit, whichever is less
  ): Promise<QueryResponse> {
    let queryCursors: ResourceMap<string> = {};
    let rateLimitConsumed = 0;
    let issuesQueried = 0;

    let queryIssues = this.graph(issueQueryString);

    do {
      if (this.tokenExpires - 300000 < Date.now()) {
        //300000 msec = 5 min
        //token expires soon; we'd rather refresh it proactively
        await this.refreshToken();
        queryIssues = this.graph(issueQueryString);
      }
      this.logger.info(
        { queryCursors },
        'Fetching batch of issues from GraphQL',
      );

      let issueResponse;
      try {
        issueResponse = await this.retryGraphQL(issueQueryString, async () => {
          return await queryIssues({
            query,
            ...queryCursors,
          });
        });
      } catch (err) {
        if (err.status === 401) {
          // why isn't this being handled inside of .retryGraphQL above?
          // because we need to generate the function queryIssues from the graph function
          // of the GraphQL client, and the token in the GraphQL client at the time of
          // invoking this.graph(queryString) gets embedded in the returned function
          // therefore, we can't change tokens without recreating the queryIssues function,
          // which means we have to re-invoke the retry function
          await this.refreshToken();
          queryIssues = this.graph(issueQueryString);
          issueResponse = await this.retryGraphQL(
            issueQueryString,
            async () => {
              return await queryIssues({
                query,
                ...queryCursors,
              });
            },
          );
        } else {
          throw err;
        }
      }
      issuesQueried += LIMITED_REQUESTS_NUM;
      const rateLimit = issueResponse.rateLimit;
      this.logger.info({ rateLimit }, 'Rate limit info for iteration');
      rateLimitConsumed += rateLimit?.cost ?? 0;
      await sleepIfApproachingRateLimit(issueResponse.rateLimit, this.logger);

      //hack to account for resourceMetadataMap on LabelsForIssues
      selectedResources = selectedResources.map((e) => {
        if (e === GithubResource.LabelsOnIssues) {
          return GithubResource.Labels;
        } else {
          return e;
        }
      });

      for (const issueQueryData of issueResponse.search.edges) {
        const { resources: pageResources } = processGraphQlPageResult(
          selectedResources,
          this.resourceMetadataMap,
          issueQueryData.node,
          GithubResource.Issues,
        );

        // Construct the issue
        const issueResponse: Issue = {
          ...pageResources.issues[0], // There will only be one issue because of the for loop
          assignees: pageResources.assignees ?? [],
          labels: pageResources.labels ?? [],
        };
        await iteratee(issueResponse);
      }

      // Check to see if we have iterated through every issue yet. We do not need to care about inner resources at this point.
      queryCursors =
        issueResponse.search.pageInfo &&
        issueResponse.search.pageInfo.hasNextPage
          ? {
              [GithubResource.Issues]: issueResponse.search.pageInfo.endCursor,
            }
          : {};
    } while (
      Object.values(queryCursors).some((c) => !!c) &&
      issuesQueried < limit
    );

    return {
      rateLimitConsumed,
    };
  }

  /**
   * Handles GraphQL requests on single resources that may contain
   * many nested resorces that each may need to be cursed through.
   *
   * @param baseResource - The first GraphQL resource to query for. Ex: pullRequests
   * @param selectedResources - The sub-objects to additionally query for. Ex: [commits]
   * @param extraQueryParams - Any additional params need to complete the GraphQL query. Ex: { login: 'coolGuy' }
   * @param queryCursors - Any cursors you have from previous GraphQL searches. Ex: { pullRequests: ==abcdefg }
   * @returns A destructured object that contains all resources that were queried for. Ex: { pullRequests: [{...}], commits: [{...}] }
   */
  public async fetchFromSingle<T extends GithubResource>(
    queryString: string,
    baseResource: T,
    selectedResources: GithubResource[],
    extraQueryParams?: { [k: string]: string | number },
    queryCursors: ResourceMap<string> = {},
  ): Promise<QueryResponse> {
    let resources: ResourceMap<any> = {};
    let rateLimitConsumed = 0;
    let hasMoreResources = false;

    let query = this.graph(queryString);

    do {
      if (this.tokenExpires - 300000 < Date.now()) {
        //300000 msec = 5 min
        //token expires soon - we'd rather refresh it proactively
        await this.refreshToken();
        query = this.graph(queryString);
      }
      let response;
      try {
        response = await this.retryGraphQL(queryString, async () => {
          return await query({
            ...extraQueryParams,
            ...queryCursors,
          });
        });
      } catch (err) {
        if (err.status === 401) {
          // why isn't this being handled inside of .retryGraphQL above?
          // because we need to generate the function 'query' from the graph function
          // of the GraphQL client, and the token in the GraphQL client at the time of
          // invoking this.graph(queryString) gets embedded in the returned function
          // therefore, we can't change tokens without recreating the 'query' function,
          // which means we have to re-invoke the retry function
          await this.refreshToken();
          query = this.graph(queryString);
          response = await this.retryGraphQL(queryString, async () => {
            return await query({
              ...extraQueryParams,
              ...queryCursors,
            });
          });
        } else {
          throw err;
        }
      }
      const rateLimit = response.rateLimit;
      rateLimitConsumed += rateLimit?.cost ?? 0;
      await sleepIfApproachingRateLimit(response.rateLimit, this.logger);

      const pathToData =
        this.resourceMetadataMap[baseResource].pathToDataInGraphQlResponse;
      const data = pathToData ? get(response, pathToData) : response;

      const { resources: pageResources, cursors: pageCursors } =
        processGraphQlPageResult(
          selectedResources,
          this.resourceMetadataMap,
          data,
          baseResource,
        );

      resources = this.extractPageResources(pageResources, resources);
      const resourceNums: Record<string, number> = {};
      for (const res of selectedResources) {
        if (Array.isArray(resources[res])) {
          resourceNums[res] = resources[res].length;
        }
      }

      // Enrich the queryCursors with the pageCursors from the most recent query.
      Object.assign(queryCursors, mapResponseCursorsForQuery(pageCursors));

      // Check only the pageCursors (which are the cursors for the most recent query) for hasNextPage = true
      hasMoreResources = responseHasNextPage(pageCursors);

      this.logger.info(
        {
          rateLimit,
          queryCursors,
          pageCursors,
          resourceNums,
          hasMoreResources,
        },
        `Rate limit info for iteration`,
      );
    } while (hasMoreResources);

    /*
      * if all has gone well, the return statement below will return an object
      * with a property for each GitHubResource requested (such as 'organization'
      * or 'collaborators'). Each of those properties will be an array of
      * the particular objects appropriate to that resource - generally a flat object
      * with a list of resource-specific properties
      *
      * Here's a short example of the processed reply provided by all the above code,
      * from our test account, where the requested GitHubResources are
      * 'organization', 'teams', and 'teamRepositories':
      *
      {
        teamRepositories: [
          {
            node: undefined,
            permission: 'TRIAGE',
            id: 'MDEwOlJlcG9zaXRvcnkzNzE0MTk1OTg=',
            teams: 'MDQ6VGVhbTQ4NTgxNjk='
          },
          {
            node: undefined,
            permission: 'TRIAGE',
            id: 'MDEwOlJlcG9zaXRvcnkzNzE0MTk1OTg=',
            teams: 'MDQ6VGVhbTQ4NTgxNzA='
          }
        ],
        teams: [
          {
            node: undefined,
            id: 'MDQ6VGVhbTQ4NTgxNjk=',
            organization: 'MDEyOk9yZ2FuaXphdGlvbjg0OTIzNTAz'
          },
          {
            node: undefined,
            id: 'MDQ6VGVhbTQ4NTgxNzA=',
            organization: 'MDEyOk9yZ2FuaXphdGlvbjg0OTIzNTAz'
          },
        ],
        organization: [ { id: 'MDEyOk9yZ2FuaXphdGlvbjg0OTIzNTAz' } ],
        rateLimitConsumed: 1
      }
      *
      * It is possible that the object returned by this function may lack
      * the expected GitHubResource property, leaving the calling function with
      * an undefined response. This happens if there were no instances of that
      * entity returned by the API, either because they don't exist in the
      * account, or something went wrong in GitHub's API processing.
      */

    return {
      ...resources,
      rateLimitConsumed,
    } as QueryResponse;
  }

  /**
   * Adds the page resources to the aggregated resources map.
   * Includes deduplication logic.
   */
  private extractPageResources<T extends Node>(
    pageOfResources: ResourceMap<T[]>,
    aggregatedResources: ResourceMap<T[]>,
  ): ResourceMap<T[]> {
    for (const [resourceName, resources] of Object.entries(pageOfResources)) {
      if (!aggregatedResources[resourceName]) {
        aggregatedResources[resourceName] = resources;
        continue;
      }
      for (const resource of resources) {
        if (
          !aggregatedResources[resourceName].find((r: T) => {
            // This dedups based on the id which we know will exist for all resources
            const found = r.id === resource.id;

            // This will handle resources with the same name, but came from different parents.
            // Unfortunately, this will never happen because of the way we are structuring graphQL :)
            const metadata = this.resourceMetadataMap[resourceName];
            if (metadata && metadata.parent) {
              return found && r[metadata.parent] === resource[metadata.parent];
            } else {
              return found;
            }
          })
        ) {
          aggregatedResources[resourceName].push(resource);
        }
      }
    }
    return aggregatedResources;
  }

  /**
   *
   * @param queryString
   * @param queryVariables
   * @private
   */
  private async retryGraphQLV2(queryString: string, queryVariables) {
    const { logger } = this;

    //queryWithRateLimitCatch will be passed to the retry function below
    const queryWithRateLimitCatch = async () => {
      let response;
      try {
        response = await this.graph(queryString)(queryVariables);
      } catch (err) {
        // Process errors thrown by `this.graph` generated functions
        let message;

        // Extract message from first GraphQL response (reject(response),
        // unknown response code in graphql.js)
        if (err.errors?.length > 0 && err.errors[0].message) {
          message = `GraphQL errors (${
            err.errors.length
          }), first: ${JSON.stringify(err.errors[0])}`;
        }

        // Catch all, we could get an Array from graphql.js (reject(response.errors))
        if (!message) {
          message = JSON.stringify(err).substring(0, 200);
        }

        //just wrapping the original error so we can be more specific about the string that caused it
        throw new IntegrationProviderAPIError({
          message,
          status: 'None',
          statusText: `GraphQL query error: ${queryString}`,
          cause: err,
          endpoint: `retryGraphQL`,
        });
      }
      validateGraphQLResponse(response, logger, queryString);
      return response;
    };

    // Check https://github.com/lifeomic/attempt for options on retry
    return await retry(queryWithRateLimitCatch, {
      maxAttempts: 3,
      delay: 30_000, // 30 seconds to start
      timeout: 180_000, // 3 min timeout. We need this in case Node hangs with ETIMEDOUT
      factor: 2, //exponential backoff factor. with 30 sec start and 3 attempts, longest wait is 2 min
      handleError: async (err, attemptContext) => {
        /* retry will keep trying to the limits of retryOptions
         * but it lets you intervene in this function - if you throw an error from in here,
         * it stops retrying. Otherwise you can just log the attempts.
         *
         * Github has "Secondary Rate Limits" in case of excessive polling or very costly API calls.
         * GitHub guidance is to "wait a few minutes" when we get one of these errors.
         * https://docs.github.com/en/rest/overview/resources-in-the-rest-api#secondary-rate-limits
         * this link is REST specific - however, the limits might apply to GraphQL as well,
         * and our GraphQL client is not using the @octokit throttling and retry plugins like our REST client
         * therefore some retry logic is appropriate here
         */

        if (err.status === 401) {
          logger.warn(
            { attemptContext, err },
            `Hit 401, attempting to refresh the token and try again.`,
          );
          await this.refreshToken();
          return;
        }

        // don't keep trying if it's not going to get better
        if (err.retryable === false || err.status === 403) {
          logger.warn(
            { attemptContext, err },
            `Hit an unrecoverable error when attempting to query GraphQL. Aborting.`,
          );
          attemptContext.abort();
        }

        if (err.message?.includes('exceeded a secondary rate limit')) {
          logger.info(
            { attemptContext, err },
            '"Secondary Rate Limit" message received.',
          );
        }

        if (err.message?.includes('Resource not accessible by integration')) {
          logger.info(
            { attemptContext, err },
            'Resource not accessible by integration: Aborting attempt',
          );
          attemptContext.abort();
        }

        logger.warn(
          { attemptContext, err },
          `Hit a possibly recoverable error when attempting to query GraphQL. Waiting before trying again.`,
        );
      },
    });
  }

  /**
   *
   */
  private async retryGraphQL(queryString: string, query: () => Promise<any>) {
    const { logger } = this;

    //queryWithRateLimitCatch will be passed to the retry function below
    const queryWithRateLimitCatch = async () => {
      let response;
      try {
        response = await query();
      } catch (err) {
        // TODO: move all this work trying to handle graphql.js reject()
        // all close as possible to the actual function generated by
        // this.graph() function. That should lead to this err being a
        // typical, well structured Error. But for tonight...

        // Process errors thrown by `this.graph` generated functions
        let message;

        // Extract message from first GraphQL response (reject(response),
        // unknown response code in graphql.js)
        if (err.errors?.length > 0 && err.errors[0].message) {
          message = `GraphQL errors (${
            err.errors.length
          }), first: ${JSON.stringify(err.errors[0])}`;
        }

        // Catch all, we could get an Array from graphql.js (reject(response.errors))
        if (!message) {
          message = JSON.stringify(err).substring(0, 200);
        }

        //just wrapping the original error so we can be more specific about the string that caused it
        throw new IntegrationProviderAPIError({
          message,
          status: 'None',
          statusText: `GraphQL query error: ${queryString}`,
          cause: err,
          endpoint: `retryGraphQL`,
        });
      }
      validateGraphQLResponse(response, logger, queryString);
      return response;
    };

    // Check https://github.com/lifeomic/attempt for options on retry
    return await retry(queryWithRateLimitCatch, {
      maxAttempts: 3,
      delay: 30_000, // 30 seconds to start
      timeout: 180_000, // 3 min timeout. We need this in case Node hangs with ETIMEDOUT
      factor: 2, //exponential backoff factor. with 30 sec start and 3 attempts, longest wait is 2 min
      handleError(err: any, attemptContext: AttemptContext) {
        /* retry will keep trying to the limits of retryOptions
         * but it lets you intervene in this function - if you throw an error from in here,
         * it stops retrying. Otherwise you can just log the attempts.
         *
         * Github has "Secondary Rate Limits" in case of excessive polling or very costly API calls.
         * GitHub guidance is to "wait a few minutes" when we get one of these errors.
         * https://docs.github.com/en/rest/overview/resources-in-the-rest-api#secondary-rate-limits
         * this link is REST specific - however, the limits might apply to GraphQL as well,
         * and our GraphQL client is not using the @octokit throttling and retry plugins like our REST client
         * therefore some retry logic is appropriate here
         */

        // don't keep trying if it's not going to get better
        if (
          err.retryable === false ||
          err.status === 401 ||
          err.status === 403
        ) {
          logger.warn(
            { attemptContext, err },
            `Hit an unrecoverable error when attempting to query GraphQL. Aborting.`,
          );
          attemptContext.abort();
        }

        if (err.message?.includes('exceeded a secondary rate limit')) {
          logger.info(
            { attemptContext, err },
            '"Secondary Rate Limit" message received.',
          );
        }

        if (err.message?.includes('Resource not accessible by integration')) {
          logger.info(
            { attemptContext, err },
            'Resource not accessible by integration: Aborting attempt',
          );
          attemptContext.abort();
        }

        logger.warn(
          { attemptContext, err },
          `Hit a possibly recoverable error when attempting to query GraphQL. Waiting before trying again.`,
        );
      },
    });
  }
}
