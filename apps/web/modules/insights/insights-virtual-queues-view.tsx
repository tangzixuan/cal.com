"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";

import InsightsLayout from "./layout";

export default function InsightsPage() {
  const { t } = useLocale();

  const { data: headers, isLoading: isHeadersLoading } =
    trpc.viewer.insights.routingFormResponsesHeaders.useQuery(
      {
        teamId: selectedTeamId ?? undefined,
        isAll: isAll ?? false,
        routingFormId: selectedRoutingFormId ?? undefined,
      },
      {
        enabled: initialConfigIsReady,
      }
    );

  return (
    <InsightsLayout>
      List all possible queues here
      {/* Get all event types where the user is a member of */}
      {/* Get all routes where this event types is included*/}
      {/* Get all virtual queues from all the routes */}
    </InsightsLayout>
  );
}
