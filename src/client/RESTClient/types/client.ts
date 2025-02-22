import { RepoKeyAndName, TokenPermissions } from '../../../types';

export interface OrgSecretRepoQueryResponse {
  //the repos that have been granted permission to an org secret
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner?: object | null;
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
}

export interface CodeScanningAlertQueryResponse {
  number: number;
  created_at: string;
  updated_at?: string | undefined;
  html_url: string;
  state: string;
  fixed_at?: string | null | undefined;
  dismissed_at?: string | null | undefined;
  dismissed_reason: 'false positive' | "won't fix" | 'used in tests' | null;
  dismissed_comment?: string | null;
  rule: {
    id?: string | null | undefined;
    name?: string;
    /**
     * The severity of the alert
     */
    severity?: string | null;
    description?: string;
    tags?: Array<string> | null | undefined;
    /**
     * The security severity of the alert.
     */
    security_severity_level?: 'low' | 'medium' | 'high' | 'critical' | null;
  };
  tool: {
    name?: string | undefined;
    version?: string | null | undefined;
  };
  repository: {
    node_id?: string; // The GraphQL identifier of the repo.
    name?: string;
    full_name?: string;
  };
  most_recent_instance: {
    location?: {
      path?: string;
    };
  };
}

export interface OrgAppQueryResponse {
  id: string; //the installation id
  respository_selection: string;
  html_url: string;
  app_id: number;
  app_slug: string; //a name for the app
  target_id: number;
  target_type: string; // typically "Organization"
  permissions: TokenPermissions;
  created_at: string;
  updated_at: string;
  events: string[];
  repository_selection: string; // 'all' || 'selected'  It doesn't actually list which are selected.
  single_file_name: string;
  has_multiple_single_files: boolean;
  single_file_paths: string[];
  suspended_by: string;
  suspended_at: string;
}

export interface SecretQueryResponse {
  name: string;
  created_at: string;
  updated_at: string;
  visibility?: string; // 'private' | 'all' | 'selected'. This means how many repos can use this secret
  selected_repositories_url?: string; //a webpage url, not a REST API url
  //the following properties are set by the integration code, not received from the REST API
  orgLogin?: string; //for use in constructing weblinks
  secretOwnerType?: string; // 'org' | 'repo' | 'env'
  secretOwnerName?: string;
  repos?: RepoKeyAndName[]; //to help build relationships with minimal memory footprint, using RepoKeyAndName instead of RepoEntity
}

export interface RepoEnvironmentQueryResponse {
  id: string;
  node_id: string;
  name: string;
  url: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  protection_rules: ProtectionRule[];
  deployment_branch_policy: {
    //sometimes null object
    protected_branches: boolean;
    custom_branch_policies: boolean;
  };
  //the following property is set by the integration code from another API call, not received from the Environments REST API
  envSecrets?: SecretQueryResponse[];
}

interface ProtectionRule {
  id: string;
  node_id: string;
  type: string; // examples include 'branch_policy', 'required_reviewers', or 'wait_timer'. Existence of other props depends on this.
  wait_timer?: number;
  reviewers?: object[]; //could be users or teams, but not all props found in OrgMemberQueryResponse or OrgTeamQueryResponse
}
