/**
 * From the name given to the data for the JupiterOne use case to the specific Github
 * GraphQl query to fetch that data (gotten via graphQL introspection)
 *
 * ex:
 *   Commits: 'commits' implies that there is a Github graphQL command 'commits'
 *   commits(first:100) {
 *     id
 *     message
 *     ...
 *   }
 *
 * Interfaces in this file represent the objects returned by the github API
 */

export enum GithubResource {
  Organization = 'organization',
  OrganizationMembers = 'membersWithRole',
  Teams = 'teams',
  TeamMembers = 'members',
  TeamRepositories = 'teamRepositories',
  Repositories = 'repositories',
  Repository = 'repository',
  PullRequests = 'pullRequests',
  PullRequest = 'pullRequest',
  Commits = 'commits',
  Labels = 'labels',
  Reviews = 'reviews',
  Issues = 'issues',
  Assignees = 'assignees',
  Collaborators = 'collaborators',
  LabelsOnIssues = 'labelsOnIssues',
}

export enum OrgMemberRole {
  Admin = 'ADMIN',
  Member = 'MEMBER',
}

export enum TeamMemberRole {
  Maintainer = 'MAINTAINER',
  Member = 'MEMBER',
}

export enum TeamRepositoryPermission {
  Admin = 'ADMIN',
  Maintain = 'MAINTAIN',
  Read = 'READ',
  Triage = 'TRIAGE',
  Write = 'WRITE',
}

export enum RepositoryVulnerabilityAlertState {
  Dismissed = 'DISMISSED',
  Fixed = 'FIXED',
  Open = 'OPEN',
}

// All Nodes MUST have an id or else they will not be parsed correctly
export interface Node {
  id: string;
}

interface Actor {
  id: string;
  databaseId?: number; // This is used to identify an app
  name?: string | null;
  login: string;
}

export interface OrgQueryResponse extends Node, Actor {
  createdAt: string;
  updatedAt: string;
  description: string;
  email: string;
  databaseId: number;
  isVerified: boolean;
  location: string;
  websiteUrl: string;
  url: string;
}

/**
 * Organization GraphQL Fragment Types
 */

export interface OrgMemberQueryResponse extends Node, Actor {
  hasTwoFactorEnabled: boolean;
  role: OrgMemberRole;
  isSiteAdmin: boolean;
  company: string;
  createdAt: string;
  databaseId: number;
  email: string;
  isEmployee: boolean;
  location: string;
  updatedAt: string;
  url: string;
  websiteUrl: string;
  organization: string; // the id of the org
}

export interface OrgTeamQueryResponse extends Node {
  url: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  databaseId: number;
  description: string;
  privacy: string;
}

//this response expresses the association between a team and a member of the team
export interface OrgTeamMemberQueryResponse extends Node {
  //id will be github User's id
  name?: string;
  login: string;
  teamId: string;
  /**
   * @Deprecated
   * A single team id, even though it is listed as a plural
   */
  teams: string;
  role: TeamMemberRole;
}

// ref: https://docs.github.com/en/graphql/reference/enums#repositoryvisibility
enum RepositoryVisibility {
  INTERNAL = 'INTERNAL',
  PRIVATE = 'PRIVATE',
  PUBLIC = 'PUBLIC',
}

export interface OrgRepoQueryResponse extends Node {
  name: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean | undefined;
  isArchived: boolean | undefined;
  createdAt: string;
  updatedAt: string;
  node_id?: string;
  autoMergeAllowed?: boolean;
  databaseId?: string;
  deleteBranchOnMerge?: boolean;
  description?: string;
  forkCount?: number;
  forkingAllowed?: boolean;
  homepageUrl?: string;
  isDisabled?: boolean;
  isEmpty?: boolean;
  isFork?: boolean;
  isInOrganization?: boolean;
  isLocked?: boolean;
  isMirror?: boolean;
  isSecurityPolicyEnabled?: boolean;
  isTemplate?: boolean;
  isUserConfigurationRepository?: boolean;
  lockReason?: string;
  mergeCommitAllowed?: boolean;
  pushedAt?: string;
  rebaseMergeAllowed?: boolean;
  visibility: RepositoryVisibility;
}

/**
 * Expresses the relationship between a repo and the team's permissions.
 */
export interface OrgTeamRepoQueryResponse extends Node {
  /**
   * The ID of the repository.
   */
  id: string;

  /**
   * The permission grant to the team for the repository.
   */
  permission: TeamRepositoryPermission;
}

/**
 * Pull Request GraphQL Fragment Types
 */
export interface PullRequestUser {
  login: string;
  name?: string;
  isSiteAdmin: boolean;
}

export interface RepositoryOwner {
  login: string;
  id: string;
  url: string;
}

export interface Commit extends Node {
  id: string;
  oid: string; // This is the sha
  message: string;
  authoredDate: string;
  changedFiles: number;
  commitUrl: string;
  author: {
    date?: string;
    user?: PullRequestUser;
  };
}

export interface MergeCommit extends Commit {
  associatedPullRequest?: AssociatedPullRequest;
}

export interface AssociatedPullRequest {
  id: string;
  number: number;
}

export interface Label extends Node {
  id: string;
  name: string;
}

export interface Review extends Node {
  id: string;
  commit?: {
    oid: string; // This is the sha
  };
  author?: PullRequestUser;
  state:
    | 'PENDING'
    | 'COMMENTED'
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'DISMISSED';
  submittedAt?: string;
  updatedAt: string;
  url: string;
}

export interface PullRequestResponse extends Node {
  id: string;
  additions: number;
  author?: PullRequestUser;
  authorAssociation: string;
  baseRefName: string;
  baseRefOid: string;
  baseRepository: {
    name: string;
    owner: RepositoryOwner;
  };
  body?: string;
  changedFiles: number;
  checksUrl: string;
  closed: boolean;
  closedAt?: string;
  createdAt: string;
  databaseId?: string;
  deletions: number;
  editor?: PullRequestUser;
  headRefName: string;
  headRefOid: string;
  headRepository: {
    name: string;
    owner: RepositoryOwner;
  };
  isDraft: boolean;
  lastEditedAt?: string;
  locked: boolean;
  mergeCommit?: MergeCommit;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  merged: boolean;
  mergedAt?: string;
  mergedBy?: PullRequestUser;
  number: number;
  permalink: string;
  publishedAt?: string;
  reviewDecision?: 'CHANGES_REQUESTED' | 'APPROVED' | 'REVIEW_REQUIRED';
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  title: string;
  updatedAt: string;
  url: string;
  // Optional extra traversals
  commits?: Commit[];
  labels?: Label[];
  reviews?: Review[];
}

export interface IssueResponse extends Node {
  id: string;
  activeLockReason: string;
  author: {
    name: string;
    login: string;
  };
  authorAssociation: string;
  body: string;
  bodyText: string;
  closed: boolean;
  closedAt: string;
  createdAt: string;
  createdViaEmail: boolean;
  databaseId: string;
  isPinned: boolean;
  lastEditedAt: string;
  locked: boolean;
  number: number;
  publishedAt: string;
  resourcePath: string;
  state: string;
  title: string;
  titleHTML: string;
  updatedAt: string;
  url: string;
  assignees?: Actor[];
  labels?: Label[];
}

export interface CollaboratorResponse extends Node {
  permission: string;
  login: string;
  name: string;
  // @Deprecated - use repositoryId
  repository?: string;
  repositoryId: string;
}

/**
 * Response structure of a Repo Vulnerability Alert aka Dependabot.
 */
export interface VulnerabilityAlertResponse extends Node {
  repository: {
    nameWithOwner: string;
  };
  createdAt: string;
  dependencyScope?: 'RUNTIME' | 'DEVELOPMENT';
  dismissReason?: string;
  dismissedAt?: string;
  dismisser?: {
    name: string;
    login: string;
    email?: string;
  };
  // fixedAt, number, state added to GHE Server in version 3.5.0
  fixedAt?: string;
  number?: number;
  state?: RepositoryVulnerabilityAlertState;
  securityAdvisory?: {
    cvss: {
      vectorString: string;
      score: number;
    };
    cwes: {
      cweId: string;
      name: string;
      description: string;
    }[];
    databaseId: number;
    description: string;
    ghsaId: string;
    id: string;
    identifiers: {
      type: 'CVE' | 'GHSA';
      value: string;
    }[];
    notificationsPermalink: string;
    origin: string;
    permalink: string;
    publishedAt: string;
    references: {
      url: string;
    }[];
    severity: string;
    summary: string;
    updatedAt?: string;
    withdrawnAt?: string;
  };
  securityVulnerability?: {
    firstPatchedVersion: {
      identifier: string;
    };
    package: {
      name: string;
      ecosystem: string;
    };
    severity: string;
    updatedAt?: string;
    vulnerableVersionRange: string;
  };
  vulnerableManifestFilename: string;
  vulnerableManifestPath: string;
  vulnerableRequirements: string;
}

export interface BranchProtectionRuleResponse extends Node {
  repoName: string;
  requiresLinearHistory: boolean;
  requiredApprovingReviewCount: number;
  dismissesStaleReviews: boolean;
  requiresCodeOwnerReviews: boolean;
  requiresCommitSignatures: boolean;
  isAdminEnforced: boolean;
  allowsForcePushes: boolean;
  allowsDeletions: boolean;
  blocksCreations: boolean;
  requiresConversationResolution: boolean;
  pattern: string;
  requiresApprovingReviews: boolean;
  requiredStatusCheckContexts: Array<string>;
  creator: {
    login: string;
  };
  databaseId: number;
  requiresStatusChecks: boolean;
  requiresStrictStatusChecks: boolean;
  restrictsPushes: boolean;
  restrictsReviewDismissals: boolean;
  requiredStatusChecks: Array<{
    context: string;
    app: {
      id: string;
      name: string;
    };
  }>;
  bypassForcePushAllowances: {
    teams: Array<Omit<Actor, 'login'>>;
    apps: Array<Omit<Actor, 'login'>>;
    users: Array<Omit<Actor, 'name'>>;
  };
  bypassPullRequestAllowances: {
    teams: Array<Actor>;
    apps: Array<Actor>;
    users: Array<Actor>;
  };
  pushAllowances: Array<Actor>;
  reviewDismissalAllowances: Array<Actor>;
}
