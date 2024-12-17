import { zodRoutes } from "@calcom/app-store/routing-forms/zod";
import { findTeamMembersMatchingAttributeLogic } from "@calcom/lib/raqb/findTeamMembersMatchingAttributeLogic";
import { raqbQueryValueSchema } from "@calcom/lib/raqb/zod";
import { getOrderedListOfLuckyUsers } from "@calcom/lib/server/getLuckyUser";
import { EventTypeRepository } from "@calcom/lib/server/repository/eventType";
import { UserRepository } from "@calcom/lib/server/repository/user";
import { SchedulingType } from "@calcom/platform-enums";
import { readonlyPrisma as prisma } from "@calcom/prisma";
import type { PerUserDataType } from "@calcom/routing-forms/components/SingleForm";
import { getSerializableForm } from "@calcom/routing-forms/lib/getSerializableForm";
import type { LocalRoute } from "@calcom/routing-forms/types/types";
import { TRPCError } from "@calcom/trpc";

class VirtualQueuesInsights {
  static async getAllVirtualQueues({ userId, routingFormId }: { userId: number; routingFormId: string }) {
    const routingForm = await prisma.app_RoutingForms_Form.findFirst({
      where: {
        id: routingFormId,
      },
      //same include from findTeamMembersMatchingAttributeLogic.handler.ts
      include: {
        team: {
          select: {
            parentId: true,
            parent: {
              select: {
                slug: true,
              },
            },
            metadata: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            movedToProfileId: true,
          },
        },
      },
    });

    if (!routingForm) {
      console.log("Can not find form");
      return null;
    }

    const orgId = await getOrgId(userId);
    if (!orgId) {
      console.log("no org");
      return null;
    }
    const attributeWithWeights = await prisma.attribute.findFirst({
      where: {
        isWeightsEnabled: true,
        teamId: orgId,
      },
    });

    if (!attributeWithWeights) {
      console.log("Virtual queues not enabled, you have to enable attribute weights");
      return null;
    }

    const userSelectedOptions = await prisma.attributeOption.findMany({
      where: {
        attributeId: attributeWithWeights.id,
        assignedUsers: {
          some: {
            member: {
              userId: userId, // Match the userId inside the related member field
            },
          },
        },
      },
    });

    if (!userSelectedOptions.length) {
      console.log("User doesn't have attributes for virtual queue set");
      return null;
    }

    const serializableForm = await getSerializableForm({ form: routingForm });

    const routes = zodRoutes.parse(serializableForm?.routes);

    // later also do for not weighted
    const weightedRoundRobinRedirectRoutes = await Promise.all(
      routes
        ?.filter((route) => "action" in route && route.action?.eventTypeId)
        .map(async (route) => {
          if ("action" in route) {
            const eventType = await prisma.eventType.findFirst({
              where: { id: route.action.eventTypeId },
            });
            return eventType?.schedulingType === SchedulingType.ROUND_ROBIN && eventType.isRRWeightsEnabled
              ? route
              : null;
          }
        }) ?? []
    );

    if (weightedRoundRobinRedirectRoutes.length > 0 && routingForm.teamId && routes) {
      const virtualQueues: {
        route: LocalRoute;
        eventTypeId: number;
        field: { id: string; label: string; attribute: { id: string; selectedOptionIds: string[] } };
      }[] = [];

      for (const roundRobinRedirectRoute of weightedRoundRobinRedirectRoutes) {
        // get attribute rules for each route
        if (roundRobinRedirectRoute?.attributesQueryValue) {
          //find if attributeWithWeights.id exists
          const parsedAttributesQueryValue = raqbQueryValueSchema.parse(
            roundRobinRedirectRoute.attributesQueryValue
          );

          if (parsedAttributesQueryValue.children1) {
            Object.values(parsedAttributesQueryValue.children1).forEach((child) => {
              if (child.properties && child.properties.field !== undefined) {
                if (child.properties.field === attributeWithWeights.id) {
                  let routingFormFieldId: string | null;
                  child.properties?.value.some((arrayobj: string[]) => {
                    arrayobj.some((attributeOptionId: string) => {
                      const content = attributeOptionId.slice(1, -1);

                      routingFormFieldId = content.includes("field:") ? content.split("field:")[1] : null;

                      const routingFormField = serializableForm.fields?.find(
                        (field) => field.id === routingFormFieldId
                      );

                      if (
                        routingFormFieldId &&
                        routingFormField &&
                        roundRobinRedirectRoute.action.eventTypeId
                      ) {
                        const fieldOptionIds = userSelectedOptions.map(
                          (selectedOption) =>
                            routingFormField.options?.find((option) => option.label === selectedOption.value)
                              ?.id ?? ""
                        );

                        const virtualQueue = {
                          route: roundRobinRedirectRoute,
                          eventTypeId: roundRobinRedirectRoute.action.eventTypeId,
                          field: {
                            id: routingFormFieldId,
                            label: routingFormField.label,
                            attribute: {
                              id: attributeWithWeights.id,
                              selectedOptionIds: fieldOptionIds,
                            },
                          },
                        };
                        virtualQueues.push(virtualQueue);
                      }
                    });
                  });
                }
              }
            });
          }
        }
      }
      const virtualQueuesHostData: {
        perUserData: PerUserDataType | null;
        matchingMembers: {
          id: number;
          name: string | null;
          email: string;
        }[];
      }[] = [];

      // get RR order for each virtual queue
      for (const virtualQueue of virtualQueues) {
        if (virtualQueue.route.attributesQueryValue?.children1) {
          const relevantAttributeQueryChildren = Object.entries(
            virtualQueue.route.attributesQueryValue.children1
          ).reduce((result, [key, child]) => {
            if (
              child.properties?.value?.some((valueArray: any[]) =>
                valueArray.some((value: string) => value.includes(`{field:${virtualQueue.field.id}}`))
              )
            ) {
              result[key] = child;
            }
            return result;
          }, {} as typeof virtualQueue.route.attributesQueryValue.children1);

          const releveantAtributeQueryValue = {
            ...virtualQueue.route.attributesQueryValue,
            children1: relevantAttributeQueryChildren,
          };

          for (const fieldOptionId of virtualQueue.field.attribute.selectedOptionIds) {
            const response = {
              [virtualQueue.field.id]: {
                label: virtualQueue.field.label,
                value: fieldOptionId, // we only support single select
              },
            };
            if (serializableForm.teamId) {
              const { teamMembersMatchingAttributeLogic: matchingTeamMembersWithResult } =
                await findTeamMembersMatchingAttributeLogic({
                  dynamicFieldValueOperands: {
                    response,
                    fields:
                      serializableForm.fields?.filter((field) => virtualQueue.field.id === field.id) ?? [],
                  },
                  attributesQueryValue: releveantAtributeQueryValue,
                  fallbackAttributesQueryValue: null,
                  teamId: serializableForm.teamId,
                  isPreview: true,
                });

              if (!matchingTeamMembersWithResult) {
                console.log("no matching members");
                return null;
              }

              const eventType = await EventTypeRepository.findByIdIncludeHostsAndTeam({
                id: virtualQueue.eventTypeId,
              });

              if (!eventType) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Event type not found",
                });
              }

              // code from findTeamMembersMatchingAttributeLogic.handler.ts
              const matchingTeamMembersIds = matchingTeamMembersWithResult.map((member) => member.userId);
              const matchingTeamMembers = await UserRepository.findByIds({ ids: matchingTeamMembersIds });
              const matchingHosts = eventType.hosts.filter((host) =>
                matchingTeamMembersIds.includes(host.user.id)
              );

              if (matchingTeamMembers.length !== matchingHosts.length) {
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: "Looks like not all matching team members are assigned to the event",
                });
              }

              const { users: orderedLuckyUsers, perUserData } = matchingTeamMembers.length
                ? await getOrderedListOfLuckyUsers({
                    // Assuming all are available
                    availableUsers: [
                      {
                        ...matchingHosts[0].user,
                        weight: matchingHosts[0].weight,
                        priority: matchingHosts[0].priority,
                      },
                      ...matchingHosts.slice(1).map((host) => ({
                        ...host.user,
                        weight: host.weight,
                        priority: host.priority,
                      })),
                    ],
                    eventType,
                    allRRHosts: matchingHosts,
                    routingFormResponse: {
                      response,
                      form: routingForm,
                      chosenRouteId: virtualQueue.route.id,
                    },
                  })
                : { users: [], perUserData: null, isUsingAttributeWeights: false };
              virtualQueuesHostData.push({
                matchingMembers: orderedLuckyUsers.map((user) => ({
                  id: user.id,
                  name: user.name,
                  email: user.email,
                })),
                perUserData,
              });
            }
          }
        }
      }
      return virtualQueuesHostData;
    }
  }
}

async function getOrgId(userId: number) {
  const org = await prisma.membership.findFirst({
    where: {
      userId,
      team: {
        isOrganization: true,
      },
    },
    select: {
      team: {
        select: {
          id: true,
        },
      },
    },
  });

  return org?.team?.id;
}

export { VirtualQueuesInsights };
