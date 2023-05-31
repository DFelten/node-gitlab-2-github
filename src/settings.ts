export default interface Settings {
  allProjects: boolean;
  archiveProjects: boolean;
  createRepo: boolean;
  migrateRepo: boolean;
  migrateComments: boolean;
  debug: boolean;
  gitlab: GitlabSettings;
  github: GithubSettings;
  projectmap: {
    [key: string]: string;
  };
  conversion: {
    useLowerCaseLabels: boolean;
  };
  transfer: {
    description: boolean;
    milestones: boolean;
    labels: boolean;
    issues: boolean;
    mergeRequests: boolean;
    releases: boolean;
  };
  useIssueImportAPI: boolean;
  usePlaceholderMilestonesForMissingMilestones: boolean;
  usePlaceholderIssuesForMissingIssues: boolean;
  useReplacementIssuesForCreationFails: boolean;
  useIssuesForAllMergeRequests: boolean;
  filterByLabel?: string;
  trimOversizedLabelDescriptions: boolean;
  skipMergeRequestStates: string[];
  skipMatchingComments: string[];
  mergeRequests: {
    logFile: string;
    log: boolean;
  };
  s3?: S3Settings;
  usermap: {
    [key: string]: {
      [key: string]: string;
    };
  };
}

export interface GithubSettings {
  baseUrl?: string;
  apiUrl?: string;
  owner: string;
  ownerIsOrg?: boolean;
  token: string;
  token_owner: string;
  // repo: string;
  timeout?: number;
  username?: string; // when is this set???
  recreateRepo?: boolean;
}

export interface GitlabSettings {
  url?: string;
  token: string;
  listArchivedProjects?: boolean;
  sessionCookie: string;
  projectsToCSV: boolean;
  // projectId(): number;
  // projectName(): string;
  // projectSlug(): string;
  // projectArchived(): boolean;
  // projectDefaultBranch(): string;
  // projectPath(): string;
  // projectTeam(): string;
  // projectTopics(): string[];
}

export interface S3Settings {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface ProjectSettings {
  gitLabId: number;
  gitLabName: string;
  gitLabSlug: string;
  gitLabPath: string;
  gitHubPath: string,
  gitHubSlug: string,
  defaultBranch: string;
  archived: boolean;
  topics: string[];
  team: string;
}
