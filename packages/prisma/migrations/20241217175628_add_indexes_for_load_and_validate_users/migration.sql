-- CreateIndex
CREATE INDEX "App_RoutingForms_FormResponse_chosenRouteId_idx" ON "App_RoutingForms_FormResponse"("chosenRouteId");

-- CreateIndex
CREATE INDEX "Attendee_noShow_idx" ON "Attendee"("noShow");

-- CreateIndex
CREATE INDEX "Booking_noShowHost_idx" ON "Booking"("noShowHost");
