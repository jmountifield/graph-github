import { Recording } from '@jupiterone/integration-sdk-testing';
import { sanitizeConfig } from '../config';
import { collaboratorSteps } from './collaborators';
import { integrationConfig } from '../../test/config';
import { setupGithubRecording } from '../../test/recording';
import {
  GithubEntities,
  GITHUB_REPO_USER_RELATIONSHIP_TYPE,
} from '../constants';
import { invocationConfig } from '..';
import { executeStepWithDependencies } from '../../test/executeStepWithDependencies';

jest.setTimeout(20000);

let recording: Recording;
afterEach(async () => {
  await recording.stop();
});

test('fetchCollaborators exec handler', async () => {
  recording = setupGithubRecording({
    directory: __dirname,
    name: 'collaborators', //redaction of headers is in setupGithubRecording
  });
  sanitizeConfig(integrationConfig);
  integrationConfig.installationId = 17214088; //this is the id the recordings are under

  const { collectedEntities, collectedRelationships, encounteredTypes } =
    await executeStepWithDependencies({
      stepId: collaboratorSteps[0].id,
      invocationConfig: invocationConfig as any,
      instanceConfig: integrationConfig,
    });

  expect({
    numCollectedEntities: collectedEntities.length,
    numCollectedRelationships: collectedRelationships.length,
    collectedEntities: collectedEntities,
    collectedRelationships: collectedRelationships,
    encounteredTypes: encounteredTypes,
  }).toMatchSnapshot();
  // _type is the same for GITHUB_COLLABORATOR and GITHUB_MEMBER, so filter on `role` also
  const outsideCollabs = collectedEntities.filter(
    (e) =>
      e._type === GithubEntities.GITHUB_COLLABORATOR._type &&
      e.role === 'OUTSIDE',
  );
  expect(outsideCollabs.length).toBeGreaterThan(0);

  const relationships = collectedRelationships.filter((e) =>
    e._type.includes(GITHUB_REPO_USER_RELATIONSHIP_TYPE),
  );
  expect(relationships.length).toBeGreaterThan(0);

  expect(outsideCollabs).toMatchGraphObjectSchema(
    GithubEntities.GITHUB_COLLABORATOR,
  );
});
