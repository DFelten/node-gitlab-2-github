import settings, { setProjektSettingsList } from '../settings';
import {
  GithubHelper,
  MilestoneImport,
  SimpleLabel,
  SimpleMilestone,
  createOctokit, getGitlabAuthor
} from './githubHelper';
import { GitLabIssue, GitLabMilestone, GitlabHelper } from './gitlabHelper';

import csv from 'csv-parser';
import * as fs from 'fs';
import { default as readlineSync } from 'readline-sync';

import { Gitlab } from '@gitbeaker/node';
import AWS from 'aws-sdk';
import { MigrationHelper, ProjectSettings } from './settings';
import { shellStuff } from './utils';
// import { spawn } from 'child-process-promise';

const CCERROR = '\x1b[31m%s\x1b[0m'; // red
const CCWARN = '\x1b[33m%s\x1b[0m'; // yellow
const CCINFO = '\x1b[36m%s\x1b[0m'; // cyan
const CCSUCCESS = '\x1b[32m%s\x1b[0m'; // green

const counters = {
  nrOfPlaceholderIssues: 0,
  nrOfReplacementIssues: 0,
  nrOfFailedIssues: 0,
  nrOfPlaceholderMilestones: 0,
};

if (settings.s3) {
  AWS.config.credentials = new AWS.Credentials({
    accessKeyId: settings.s3.accessKeyId,
    secretAccessKey: settings.s3.secretAccessKey,
  });
}

// Ensure that the GitLab token has been set in settings.js
if (
  !settings.gitlab.token ||
  settings.gitlab.token === '{{gitlab private token}}'
) {
  console.log(
    '\n\nYou have to enter your GitLab private token in the settings.js file.'
  );
  process.exit(1);
}

loopProjects();

async function loopProjects() {
  console.log('Looping projects');
  if (settings.createAllRepos) {
    importProjectSettings('projects-imported.csv').then(async (projectSettingsList) => {
      for (let projectSettings of projectSettingsList) {
        if (projectSettings?.gitHubSlug !== null) {
          await delay(2000);
          await setUpRepo(getMigrationHelper(projectSettings), false);
        }
      }
    });

  } else if (settings.archiveProjects) {
    importProjectSettings('projects-finished.csv').then(async (projectSettingsList) => {
      for (let projectSettings of projectSettingsList) {
        var migrationHelper = getMigrationHelper(projectSettings);

        if (migrationHelper.projectSettings.archived === true) {
          await migrationHelper.github.archiveRepo();
        }
      }
    });
  } else if (settings.addOnlyTopics) {
    importProjectSettings('projects-finished.csv').then(async (projectSettingsList) => {
      for (let projectSettings of projectSettingsList) {
        var migrationHelper = getMigrationHelper(projectSettings);

        var topics = migrationHelper.projectSettings.topics;

        if (topics !== undefined && topics.length > 0) {
          await migrationHelper.github.addTopics(topics);
        }
      }
    });
  } else {
    importProjectSettings('projects.csv').then(async (projectSettingsList) => {
      // if (settings.gitlab.projectsToCSV) {
      //   new GitlabHelper(gitlabApi, settings.gitlab, projectSettingsList[0]).projectsToCSV();
      // }
      if (settings.projectId !== null) {
        var projectSettings = projectSettingsList.find((project) => project.gitLabId === settings.projectId);

        if (projectSettings !== undefined) {
          await setUpOrMigrate(getMigrationHelper(projectSettings));
        }
      }
    });
  }
}

async function setUpOrMigrate(migrationHelper: MigrationHelper) {
  // setProjektSettings(projectSettings);

  if (settings.createRepo) {
    await setUpRepo(migrationHelper, true);
  } else {
    await migrateRepo(migrationHelper);
  }
}

async function migrateRepo(migrationHelper: MigrationHelper) {
  if (settings.migrateRepo) {
    await migrate(migrationHelper);
  }

  if (settings.transfer.comments) {
    await transferIssueComments(migrationHelper);
  }
}

async function setUpRepo(migrationHelper: MigrationHelper, shouldMigrateRepo: boolean = false) {
  console.log('Setting up repo for ' + migrationHelper.projectSettings.gitLabPath);

  shellStuff('git clone --mirror git@gitlab.trimexa.de:' + migrationHelper.projectSettings.gitLabPath + '.git repos/' + migrationHelper.projectSettings.gitLabPath, async () => {
    if (settings.github.recreateRepo === true) {
      await migrationHelper.github.deleteRepo(migrationHelper.projectSettings.gitHubSlug);
    }

    var command = 'gh repo create ' + migrationHelper.projectSettings.gitHubPath + ' --private';

    if (migrationHelper.projectSettings.team != null && migrationHelper.projectSettings.team != '') {
      command += ' -t ' + migrationHelper.projectSettings.team;
    }

    shellStuff(command, async () => {
      shellStuff('git -C repos/' + migrationHelper.projectSettings.gitLabPath + ' push --no-verify --mirror git@github.com:' + migrationHelper.projectSettings.gitHubPath, async () => {
        shellStuff('gh repo edit ' + migrationHelper.projectSettings.gitHubPath + ' --default-branch ' + migrationHelper.projectSettings.defaultBranch);

        await migrationHelper.github.addTopics(migrationHelper.projectSettings.topics);



        if (shouldMigrateRepo === true) {
          await delay(2000);

          await migrateRepo(migrationHelper);
        }
      });
    }, true);
  }, true);
}

// function createHelpers(projectSettings: ProjectSettings) {
//   gitlabHelper = new GitlabHelper(gitlabApi, settings.gitlab, projectSettings);
//   githubHelper = new GithubHelper(
//     createOctokit(settings.github.token),
//     settings.github,
//     gitlabHelper,
//     settings.useIssuesForAllMergeRequests,
//   );
// }

// ----------------------------------------------------------------------------

/**
 * Asks for confirmation and maybe recreates the GitHub repository.
 */
async function recreate(githubHelper: GithubHelper) {
  readlineSync.setDefaultOptions({
    limit: ['no', 'yes'],
    limitMessage: 'Please enter yes or no',
    defaultInput: 'no',
  });
  const ans = readlineSync.question('Delete and recreate? [yes/no] ');
  if (ans == 'yes') await githubHelper.recreateRepo();
  else console.log("OK, I won't delete anything then.");
}

/**
 * Creates dummy data for a placeholder milestone
 *
 * @param expectedIdx Number of the GitLab milestone
 * @returns Data for the milestone
 */
function createPlaceholderMilestone(expectedIdx: number): MilestoneImport {
  return {
    id: -1, // dummy
    iid: expectedIdx,
    title: `[PLACEHOLDER] - for milestone #${expectedIdx}`,
    description:
      'This is to ensure that milestone numbers in GitLab and GitHub are the same',
    state: 'closed',
  };
}

/**
 * Creates dummy data for a placeholder issue
 *
 * @param expectedIdx Number of the GitLab issue
 * @returns Data for the issue
 */
function createPlaceholderIssue(expectedIdx: number): Partial<GitLabIssue> {
  return {
    iid: expectedIdx,
    title: `[PLACEHOLDER] - for issue #${expectedIdx}`,
    description:
      'This is to ensure that issue numbers in GitLab and GitHub are the same',
    state: 'closed',
    isPlaceholder: true,
  };
}

// ----------------------------------------------------------------------------

/**
 * Creates a so-called "replacement-issue".
 *
 * This is used for issues where the migration fails. The replacement issue will
 * have the same number and title, but the original description will be lost.
 */
function createReplacementIssue(issue: GitLabIssue) {
  let description = `The original issue\n\n\tId: ${issue.iid}\n\tTitle: ${issue.title}\n\ncould not be created.\nThis is a dummy issue, replacing the original one.`;

  if (issue.web_url) {
    description += `In case the gitlab repository still exists, visit the following link to see the original issue:\n\n${issue.web_url}`;
  }

  return {
    iid: issue.iid,
    title: `${issue.title} [REPLACEMENT ISSUE]`,
    description,
    state: issue.state,
    created_at: issue.created_at,
  };
}

// ----------------------------------------------------------------------------

/**
 * Performs all of the migration tasks to move a GitLab repo to GitHub
 */
async function migrate(migrationHelper: MigrationHelper) {
  console.log('Migrate repo for ' + migrationHelper.projectSettings.gitLabPath);
  //
  // Sequentially transfer repo things
  //

  try {
    await migrationHelper.github.registerRepoId();
    await migrationHelper.gitlab.registerProjectPath(migrationHelper.projectSettings.gitLabId);

    if (settings.transfer.description) {
      await transferDescription(migrationHelper);
    }

    if (settings.transfer.milestones) {
      await transferMilestones(
        migrationHelper,
        settings.usePlaceholderMilestonesForMissingMilestones
      );
    }

    if (settings.transfer.labels) {
      await transferLabels(migrationHelper, true, settings.conversion.useLowerCaseLabels);
    }

    if (settings.transfer.releases) {
      await transferReleases(migrationHelper);
    }

    // Important: do this before transferring the merge requests
    if (settings.transfer.issues) {
      await transferIssues(migrationHelper);
    }

    if (settings.transfer.mergeRequests) {
      if (settings.mergeRequests.log) {
        await logMergeRequests(migrationHelper, settings.mergeRequests.logFile);
      } else {
        await transferMergeRequests(migrationHelper);
      }
    }
  } catch (err) {
    console.error('Error during transfer:');
    console.error(err);
  }

  console.log('\n\nTransfer complete!\n\n');
}

// ----------------------------------------------------------------------------

/**
 * Transfer the description of the repository.
 */
async function transferDescription(migrationHelper: MigrationHelper) {
  inform('Transferring Description');

  let project = await migrationHelper.gitlab.gitlabApi.Projects.show(migrationHelper.projectSettings.gitLabId);

  if (project.description) {
    await migrationHelper.github.updateRepositoryDescription(project.description);
    console.log('Done.');
  } else {
    console.log('Description is empty, nothing to transfer.')
  }
}

// ----------------------------------------------------------------------------

/**
 * Transfer any milestones that exist in GitLab that do not exist in GitHub.
 */
async function transferMilestones(migrationHelper: MigrationHelper, usePlaceholders: boolean) {
  inform('Transferring Milestones');

  // Get a list of all milestones associated with this project
  // FIXME: don't use type join but ensure everything is milestoneImport
  let milestones: (GitLabMilestone | MilestoneImport)[] =
    await migrationHelper.gitlab.gitlabApi.ProjectMilestones.all(migrationHelper.projectSettings.gitLabId);

  // sort milestones in ascending order of when they were created (by id)
  milestones = milestones.sort((a, b) => a.id - b.id);

  // get a list of the current milestones in the new GitHub repo (likely to be empty)
  const githubMilestones = await migrationHelper.github.getAllGithubMilestones();
  let lastMilestoneId = 0;
  milestones.forEach(milestone => {
    lastMilestoneId = Math.max(lastMilestoneId, milestone.iid);
  });

  let milestoneMap = new Map<number, SimpleMilestone>();
  for (let i = 0; i < milestones.length; i++) {
    let milestone = milestones[i];
    let expectedIdx = i + 1; // GitLab internal Id (iid)

    // Create placeholder milestones so that new GitHub milestones will have
    // the same milestone number as in GitLab. Gaps are caused by deleted
    // milestones
    if (usePlaceholders && milestone.iid !== expectedIdx) {
      let placeholder = createPlaceholderMilestone(expectedIdx);
      milestones.splice(i, 0, placeholder);
      counters.nrOfPlaceholderMilestones++;
      console.log(
        `Added placeholder milestone for GitLab milestone %${expectedIdx}.`
      );
      milestoneMap.set(expectedIdx, {
        number: expectedIdx,
        title: placeholder.title,
      });
    } else {
      milestoneMap.set(milestone.iid, {
        number: expectedIdx,
        title: milestone.title,
      });
    }
  }
  await migrationHelper.github.registerMilestoneMap(milestoneMap);

  // if a GitLab milestone does not exist in GitHub repo, create it.

  for (let milestone of milestones) {
    let foundMilestone = githubMilestones.find(
      m => m.title === milestone.title
    );
    if (!foundMilestone) {
      console.log('Creating: ' + milestone.title);
      await migrationHelper.github
        .createMilestone(milestone)
        .then(created => {
          let m = milestoneMap.get(milestone.iid);
          if (m && m.number != created.number) {
            throw new Error(
              `Mismatch between milestone ${m.number}: '${m.title}' in map and created ${created.number}: '${created.title}'`
            );
          }
        })
        .catch(err => {
          console.error(`Error creating milestone '${milestone.title}'.`);
          console.error(err);
        });
    } else {
      console.log('Already exists: ' + milestone.title);
    }
  }
}

// ----------------------------------------------------------------------------

/**
 * Transfer any labels that exist in GitLab that do not exist in GitHub.
 */
async function transferLabels(migrationHelper: MigrationHelper, attachmentLabel = true, useLowerCase = true) {
  inform('Transferring Labels');
  console.warn(CCWARN, 'NOTE (2022): GitHub descriptions are limited to 100 characters, and do not accept 4-byte Unicode');

  const invalidUnicode = /[\u{10000}-\u{10FFFF}]|(?![*#0-9]+)[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}]/gu;

  // Get a list of all labels associated with this project
  let labels: SimpleLabel[] = await migrationHelper.gitlab.gitlabApi.Labels.all(
    migrationHelper.projectSettings.gitLabId
  );

  // get a list of the current label names in the new GitHub repo (likely to be just the defaults)
  let githubLabels: string[] = await migrationHelper.github.getAllGithubLabelNames();

  // create a hasAttachment label for manual attachment migration
  if (attachmentLabel) {
    const hasAttachmentLabel = {
      name: 'has attachment',
      color: '#fbca04',
      description: 'Attachment was not transfered from GitLab',
    };
    labels.push(hasAttachmentLabel);
  }

  const gitlabMergeRequestLabel = {
    name: 'gitlab merge request',
    color: '#b36b00',
    description: '',
  };
  labels.push(gitlabMergeRequestLabel);

  // if a GitLab label does not exist in GitHub repo, create it.
  for (let label of labels) {
    // GitHub prefers lowercase label names
    if (useLowerCase) label.name = label.name.toLowerCase();

    if (!githubLabels.find(l => l === label.name)) {
      console.log('Creating: ' + label.name);

      if (label.description) {
        if (label.description.match(invalidUnicode)) {
          console.warn(CCWARN, `⚠️ Removed invalid unicode characters from description.`);
          const cleanedDescription = label.description.replace(invalidUnicode, '').trim();
          console.debug(` "${label.description}"\n\t to\n "${cleanedDescription}"`);
          label.description = cleanedDescription;
        }
        if (label.description.length > 100) {
          const trimmedDescription = label.description.slice(0, 100).trim();
          if (settings.trimOversizedLabelDescriptions) {
            console.warn(CCWARN, `⚠️ Description too long (${label.description.length}), it was trimmed:`);
            console.debug(` "${label.description}"\n\t to\n "${trimmedDescription}"`);
            label.description = trimmedDescription;
          } else {
            console.warn(CCWARN, `⚠️ Description too long (${label.description.length}), it was excluded.`);
            console.debug(` "${label.description}"`);
            label.description = '';
          }
        }
      }

      try {
        // process asynchronous code in sequence
        await migrationHelper.github.createLabel(label).catch(x => { });
      } catch (err) {
        console.error('Could not create label', label.name);
        console.error(err);
      }
    } else {
      console.log('Already exists: ' + label.name);
    }
  }
}

async function transferIssueComments(migrationHelper: MigrationHelper) {
  let issues = (await migrationHelper.gitlab.gitlabApi.Issues.all({
    projectId: migrationHelper.projectSettings.gitLabId,
    labels: settings.filterByLabel,
  })) as GitLabIssue[];
  var test = settings;
  // sort issues in ascending order of their issue number (by iid)
  issues = issues.sort((a, b) => a.iid - b.iid);

  if (settings.importCommentsForIssueId !== undefined && settings.importCommentsForIssueId !== null) {
    var importCommentsForIssueId = settings.importCommentsForIssueId;

    const issue = issues.find(({ iid }) => iid === importCommentsForIssueId);

    if (issue !== null) {
      await migrationHelper.github.createCommentsForIssue(issue);
    }
  } else {
    for (let issue of issues) {
      if (!(settings.ignoreIssuesForComments?.includes(issue.iid))) {
        // if (settings.latestImportedIssueIdForComments === undefined || issue.iid <= settings.latestImportedIssueIdForComments) {
        if (settings.latestImportedIssueIdForComments === undefined || issue.iid > settings.latestImportedIssueIdForComments) {
          if (issue.iid <= 410) {

            await migrationHelper.github.createCommentsForIssue(issue);
          }
        }
      }
    }
  }

  console.log(`Comments migrated (${new Date()})`);
}

// ----------------------------------------------------------------------------

/**
 * Transfer any issues and their comments that exist in GitLab that do not exist in GitHub.
 */
async function transferIssues(migrationHelper: MigrationHelper) {
  inform('Transferring Issues');

  await migrationHelper.github.registerMilestoneMap();

  // get a list of all GitLab issues associated with this project
  // TODO return all issues via pagination
  let issues = (await migrationHelper.gitlab.gitlabApi.Issues.all({
    projectId: migrationHelper.projectSettings.gitLabId,
    labels: settings.filterByLabel,
  })) as GitLabIssue[];

  // sort issues in ascending order of their issue number (by iid)
  issues = issues.sort((a, b) => a.iid - b.iid);

  // get a list of the current issues in the new GitHub repo (likely to be empty)
  let githubIssues = await migrationHelper.github.getAllGithubIssues();

  console.log(`Transferring ${issues.length} issues.`);

  if (settings.usePlaceholderIssuesForMissingIssues) {
    for (let i = 0; i < issues.length; i++) {
      // GitLab issue internal Id (iid)
      let expectedIdx = i + 1;

      // is there a gap in the GitLab issues?
      // Create placeholder issues so that new GitHub issues will have the same
      // issue number as in GitLab. If a placeholder is used it is because there
      // was a gap in GitLab issues -- likely caused by a deleted GitLab issue.
      if (issues[i].iid !== expectedIdx) {
        issues.splice(i, 0, createPlaceholderIssue(expectedIdx) as GitLabIssue); // HACK: remove type coercion
        counters.nrOfPlaceholderIssues++;
        console.log(
          `Added placeholder issue for GitLab issue #${expectedIdx}.`
        );
      }
    }
  }

  //
  // Create GitHub issues for each GitLab issue
  //

  // if a GitLab issue does not exist in GitHub repo, create it -- along with comments.
  for (let issue of issues) {
    if (settings.latestImportedIssueId === undefined || issue.iid > settings.latestImportedIssueId) {
      // try to find a GitHub issue that already exists for this GitLab issue
      let githubIssue = githubIssues.find(
        i => i.title.trim() === issue.title.trim()
      );
      if (!githubIssue) {
        console.log(`\nMigrating issue #${issue.iid} ('${issue.title}')...`);
        try {
          // process asynchronous code in sequence -- treats the code sort of like blocking
          await migrationHelper.github.createIssueAndComments(issue);
          console.log(`\t...DONE migrating issue #${issue.iid}.`);
        } catch (err) {
          console.log(`\t...ERROR while migrating issue #${issue.iid}.`);

          console.error('DEBUG:\n', err); // TODO delete this after issue-migration-fails have been fixed

          if (settings.useReplacementIssuesForCreationFails) {
            console.log('\t-> creating a replacement issue...');
            const replacementIssue = createReplacementIssue(issue);
            try {
              await migrationHelper.github.createIssueAndComments(
                replacementIssue as GitLabIssue,
              ); // HACK: remove type coercion

              counters.nrOfReplacementIssues++;
              console.error('\t...DONE.');
            } catch (err) {
              counters.nrOfFailedIssues++;
              console.error(
                '\t...ERROR: Could not create replacement issue either!'
              );
            }
          }
        }

      } else {
        console.log(`Updating issue #${issue.iid} - ${issue.title}...`);
        try {
          await migrationHelper.github.updateIssueState(githubIssue, issue);
          console.log(`...Done updating issue #${issue.iid}.`);
        } catch (err) {
          console.log(`...ERROR while updating issue #${issue.iid}.`);
        }
      }
    }
  }

  // print statistics about issue migration:
  console.log(`DONE creating issues.`);
  console.log(`\n\tStatistics:`);
  console.log(`\tTotal nr. of issues: ${issues.length}`);
  console.log(
    `\tNr. of used placeholder issues: ${counters.nrOfPlaceholderIssues}`
  );
  console.log(
    `\tNr. of used replacement issues: ${counters.nrOfReplacementIssues}`
  );
  console.log(`\tNr. of issue migration fails: ${counters.nrOfFailedIssues}`);
}
// ----------------------------------------------------------------------------

/**
 * Transfer any merge requests that exist in GitLab that do not exist in GitHub
 * TODO - Update all text references to use the new issue numbers;
 *        GitHub treats pull requests as issues, therefore their numbers are changed
 * @returns {Promise<void>}
 */
async function transferMergeRequests(migrationHelper: MigrationHelper) {
  inform('Transferring Merge Requests');

  await migrationHelper.github.registerMilestoneMap();

  // Get a list of all pull requests (merge request equivalent) associated with
  // this project
  let mergeRequests = await migrationHelper.gitlab.gitlabApi.MergeRequests.all({
    projectId: migrationHelper.projectSettings.gitLabId,
    labels: settings.filterByLabel,
  });

  // Sort merge requests in ascending order of their number (by iid)
  mergeRequests = mergeRequests.sort((a, b) => a.iid - b.iid);

  // Get a list of the current pull requests in the new GitHub repo (likely to
  // be empty)
  let githubPullRequests = await migrationHelper.github.getAllGithubPullRequests();

  // get a list of the current issues in the new GitHub repo (likely to be empty)
  // Issues are sometimes created from Gitlab merge requests. Avoid creating duplicates.
  let githubIssues = await migrationHelper.github.getAllGithubIssues();

  console.log(
    'Transferring ' + mergeRequests.length.toString() + ' merge requests'
  );

  //
  // Create GitHub pull request for each GitLab merge request
  //

  // if a GitLab merge request does not exist in GitHub repo, create it -- along
  // with comments
  for (let mr of mergeRequests) {
    if (settings.latestImportedMergeRequestId === undefined || mr.iid > settings.latestImportedMergeRequestId) {
      // Try to find a GitHub pull request that already exists for this GitLab
      // merge request
      let githubRequest = githubPullRequests.find(
        i => i.title.trim() === mr.title.trim()
      );
      let githubIssue = githubIssues.find(
        // allow for issues titled "Original Issue Name - [merged|closed]"
        i => {
          // regex needs escaping in case merge request title contains special characters
          const regex = new RegExp(escapeRegExp(mr.title.trim()) + ' - \\[(merged|closed)\\]');
          return regex.test(i.title.trim());
        }
      );
      if (!githubRequest && !githubIssue) {
        if (settings.skipMergeRequestStates.includes(mr.state)) {
          console.log(
            `Skipping MR ${mr.iid} in "${mr.state}" state: ${mr.title}`
          );
          continue;
        }
        console.log('Creating pull request: !' + mr.iid + ' - ' + mr.title);
        try {
          // process asynchronous code in sequence
          await migrationHelper.github.createPullRequestAndComments(mr);
        } catch (err) {
          console.error(
            'Could not create pull request: !' + mr.iid + ' - ' + mr.title
          );
          console.error(err);
        }
      } else {
        if (githubRequest) {
          console.log(
            'Gitlab merge request already exists (as github pull request): ' +
            mr.iid +
            ' - ' +
            mr.title
          );
          migrationHelper.github.updatePullRequestState(githubRequest, mr);
        } else {
          console.log(
            'Gitlab merge request already exists (as github issue): ' +
            mr.iid +
            ' - ' +
            mr.title
          );
        }
      }
    }
  }
}

/**
 * Transfer any releases that exist in GitLab that do not exist in GitHub
 * Please note that due to github api restrictions, this only transfers the
 * name, description and tag name of the release. It sorts the releases chronologically
 * and creates them on github one by one
 * @returns {Promise<void>}
 */
async function transferReleases(migrationHelper: MigrationHelper) {
  inform('Transferring Releases');

  // Get a list of all releases associated with this project
  let releases = await migrationHelper.gitlab.gitlabApi.Releases.all(migrationHelper.projectSettings.gitLabId);

  // Sort releases in ascending order of their release date
  releases = releases.sort((a, b) => {
    return (new Date(a.released_at) as any) - (new Date(b.released_at) as any);
  });

  console.log('Transferring ' + releases.length.toString() + ' releases');

  //
  // Create GitHub release for each GitLab release
  //

  // if a GitLab release does not exist in GitHub repo, create it
  for (let release of releases) {
    // Try to find an existing github release that already exists for this GitLab
    // release
    let githubRelease = await migrationHelper.github.getReleaseByTag(release.tag_name);

    if (!githubRelease) {
      console.log(
        'Creating release: !' + release.name + ' - ' + release.tag_name
      );
      try {
        // process asynchronous code in sequence
        await migrationHelper.github.createRelease(
          release.tag_name,
          release.name,
          release.description,
          getGitlabAuthor(release?.user?.name),
        );
      } catch (err) {
        console.error(
          'Could not create release: !' +
          release.name +
          ' - ' +
          release.tag_name
        );
        console.error(err);
      }
    } else {
      console.log(
        'Gitlab release already exists (as github release): ' +
        githubRelease.data.name +
        ' - ' +
        githubRelease.data.tag_name
      );
    }
  }
}

//-----------------------------------------------------------------------------

/**
 * logs merge requests that exist in GitLab to a file.
 */
async function logMergeRequests(migrationHelper: MigrationHelper, logFile: string) {
  inform('Logging Merge Requests');

  // get a list of all GitLab merge requests associated with this project
  // TODO return all MRs via pagination
  let mergeRequests = await migrationHelper.gitlab.gitlabApi.MergeRequests.all({
    projectId: migrationHelper.projectSettings.gitLabId,
    labels: settings.filterByLabel,
  });

  // sort MRs in ascending order of when they were created (by id)
  mergeRequests = mergeRequests.sort((a, b) => a.id - b.id);

  console.log('Logging ' + mergeRequests.length.toString() + ' merge requests');

  for (let mr of mergeRequests) {
    let mergeRequestDiscussions = await migrationHelper.gitlab.gitlabApi.MergeRequestDiscussions.all(
      migrationHelper.projectSettings.gitLabId,
      mr.iid
    );
    let mergeRequestNotes = await migrationHelper.gitlab.gitlabApi.MergeRequestNotes.all(
      migrationHelper.projectSettings.gitLabId,
      mr.iid,
      {}
    );

    mr.discussions = mergeRequestDiscussions ? mergeRequestDiscussions : [];
    mr.notes = mergeRequestNotes ? mergeRequestNotes : [];
  }

  //
  // Log the merge requests to a file
  //
  const output = { mergeRequests: mergeRequests };

  fs.writeFileSync(logFile, JSON.stringify(output, null, 2));
}

// ----------------------------------------------------------------------------

/**
 * Print out a section heading to let the user know what is happening
 */
function inform(msg: string) {
  console.log('==================================');
  console.log(msg);
  console.log('==================================');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export async function importProjectSettings(file: string): Promise<ProjectSettings[]> {
  var projectSettingsList: ProjectSettings[] = [];

  const projects = await readCSVFile(file);

  projects.forEach(function (project) {
    var newSlug = project['new_slug'] !== '' ? project['new_slug'] : project['slug'];

    projectSettingsList.push({
      gitLabId: Number(project['id']),
      gitLabName: project['name'],
      gitLabSlug: project['slug'],
      gitLabPath: project['path'],
      gitHubPath: `trimexa/${newSlug}`,
      gitHubSlug: newSlug,
      defaultBranch: project['default_branch'],
      archived: project['archived'] === 'TRUE',
      topics: project['topics'] != '' ? (project['topics']?.split(',')) : [],
      team: project['team'],
    });
  });

  setProjektSettingsList(projectSettingsList);

  return projectSettingsList;
}

async function readCSVFile(filePath: string): Promise<object[]> {
  const results: object[] = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

function extractArguments(arg: string) {
  var field = `${arg}=`;
  const found = process.argv.find(element => element.includes(field));

  return found.replace(field, '');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getMigrationHelper(projectSettings: ProjectSettings): MigrationHelper {
  const gitlabApi = new Gitlab({
    host: settings.gitlab.url ? settings.gitlab.url : 'http://gitlab.com',
    token: settings.gitlab.token,
  });

  var gitlabHelper = new GitlabHelper(gitlabApi, settings.gitlab, projectSettings);

  return {
    projectSettings: projectSettings,
    gitlab: gitlabHelper,
    github: new GithubHelper(
      createOctokit(settings.github.token),
      settings.github,
      gitlabHelper,
      settings.useIssuesForAllMergeRequests,
      projectSettings,
    ),
  };
}
