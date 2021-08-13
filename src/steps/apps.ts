import {
  IntegrationStep,
  IntegrationStepExecutionContext,
  RelationshipClass,
  IntegrationMissingKeyError,
  createDirectRelationship,
} from '@jupiterone/integration-sdk-core';

import { createAPIClient } from '../client';
import { IntegrationConfig } from '../config';
import { DATA_ACCOUNT_ENTITY } from './account';
import { toAppEntity } from '../sync/converters';
import { AccountEntity, RepoEntity } from '../types';
import {
  GITHUB_ACCOUNT_ENTITY_TYPE,
  GITHUB_APP_ENTITY_TYPE,
  GITHUB_APP_ENTITY_CLASS,
  GITHUB_ACCOUNT_APP_RELATIONSHIP_TYPE,
} from '../constants';

export async function fetchApps({
  instance,
  logger,
  jobState,
}: IntegrationStepExecutionContext<IntegrationConfig>) {
  const config = instance.config;
  const apiClient = createAPIClient(config, logger);

  const accountEntity = await jobState.getData<AccountEntity>(
    DATA_ACCOUNT_ENTITY,
  );

  if (!accountEntity) {
    throw new IntegrationMissingKeyError(
      `Expected to find Account entity in jobState.`,
    );
  }

  await apiClient.iterateApps(async (app) => {
    const appEntity = (await jobState.addEntity(
      toAppEntity(app),
    )) as RepoEntity;

    await jobState.addRelationship(
      createDirectRelationship({
        _class: RelationshipClass.INSTALLED,
        from: accountEntity,
        to: appEntity,
      }),
    );
  });
}

export const appSteps: IntegrationStep<IntegrationConfig>[] = [
  {
    id: 'fetch-apps',
    name: 'Fetch Apps',
    entities: [
      {
        resourceName: 'Github App',
        _type: GITHUB_APP_ENTITY_TYPE,
        _class: GITHUB_APP_ENTITY_CLASS,
      },
    ],
    relationships: [
      {
        _type: GITHUB_ACCOUNT_APP_RELATIONSHIP_TYPE,
        _class: RelationshipClass.INSTALLED,
        sourceType: GITHUB_ACCOUNT_ENTITY_TYPE,
        targetType: GITHUB_APP_ENTITY_TYPE,
      },
    ],
    dependsOn: ['fetch-account'],
    executionHandler: fetchApps,
  },
];
