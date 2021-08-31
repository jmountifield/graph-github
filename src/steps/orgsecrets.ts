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
import { AccountEntity, IdEntityMap, RepoEntity, SecretEntity } from '../types';
import {
  GITHUB_ACCOUNT_ENTITY_TYPE,
  GITHUB_REPO_ENTITY_TYPE,
  GITHUB_ORG_SECRET_ENTITY_TYPE,
  GITHUB_SECRET_ENTITY_CLASS,
  GITHUB_ACCOUNT_SECRET_RELATIONSHIP_TYPE,
  GITHUB_REPO_ORG_SECRET_RELATIONSHIP_TYPE,
  GITHUB_REPO_ARRAY,
  GITHUB_ORG_SECRET_BY_NAME_MAP,
} from '../constants';
import { toOrgSecretEntity } from '../sync/converters';

export async function fetchOrgSecrets({
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
  const repoEntities = await jobState.getData<RepoEntity[]>(GITHUB_REPO_ARRAY);
  if (!repoEntities) {
    throw new IntegrationMissingKeyError(
      `Expected repos.ts to have set ${GITHUB_REPO_ARRAY} in jobState.`,
    );
  }

  const orgSecretsByNameMap: IdEntityMap<SecretEntity> = {};

  await apiClient.iterateOrgSecrets(repoEntities, async (secret) => {
    const secretEntity = (await jobState.addEntity(
      toOrgSecretEntity(secret, apiClient.accountClient.login || ''),
    )) as SecretEntity;

    await jobState.addRelationship(
      createDirectRelationship({
        _class: RelationshipClass.HAS,
        from: accountEntity,
        to: secretEntity,
      }),
    );

    //for every org type, add a USES relationship for all repos with access to secret
    if (secret.repos) {
      for (const repoEntity of secret.repos) {
        await jobState.addRelationship(
          createDirectRelationship({
            _class: RelationshipClass.USES,
            from: repoEntity,
            to: secretEntity,
          }),
        );
      }
    }
    orgSecretsByNameMap[secret.name] = secretEntity;
  });

  await jobState.setData(GITHUB_ORG_SECRET_BY_NAME_MAP, orgSecretsByNameMap);
}

export const orgSecretSteps: IntegrationStep<IntegrationConfig>[] = [
  {
    id: 'fetch-org-secrets',
    name: 'Fetch Organization Secrets',
    entities: [
      {
        resourceName: 'GitHub Org Secret',
        _type: GITHUB_ORG_SECRET_ENTITY_TYPE,
        _class: GITHUB_SECRET_ENTITY_CLASS,
      },
    ],
    relationships: [
      {
        _type: GITHUB_ACCOUNT_SECRET_RELATIONSHIP_TYPE,
        _class: RelationshipClass.HAS,
        sourceType: GITHUB_ACCOUNT_ENTITY_TYPE,
        targetType: GITHUB_ORG_SECRET_ENTITY_TYPE,
      },
      {
        _type: GITHUB_REPO_ORG_SECRET_RELATIONSHIP_TYPE,
        _class: RelationshipClass.USES,
        sourceType: GITHUB_REPO_ENTITY_TYPE,
        targetType: GITHUB_ORG_SECRET_ENTITY_TYPE,
      },
    ],
    dependsOn: ['fetch-account', 'fetch-repos'],
    executionHandler: fetchOrgSecrets,
  },
];
