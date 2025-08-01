"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Prisma } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import LicenseRequired from "@calcom/features/ee/common/components/LicenseRequired";
import { subdomainSuffix } from "@calcom/features/ee/organizations/lib/orgDomains";
import OrgAppearanceViewWrapper from "@calcom/features/ee/organizations/pages/settings/appearance";
import SectionBottomActions from "@calcom/features/settings/SectionBottomActions";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { md } from "@calcom/lib/markdownIt";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import turndown from "@calcom/lib/turndownService";
import { trpc } from "@calcom/trpc/react";
import { Avatar } from "@calcom/ui/components/avatar";
import { Button } from "@calcom/ui/components/button";
import { LinkIconButton } from "@calcom/ui/components/button";
import { Editor } from "@calcom/ui/components/editor";
import { Form } from "@calcom/ui/components/form";
import { Label } from "@calcom/ui/components/form";
import { TextField } from "@calcom/ui/components/form";
import { Icon } from "@calcom/ui/components/icon";
import { BannerUploader, ImageUploader } from "@calcom/ui/components/image-uploader";
// if I include this in the above barrel import, I get a runtime error that the component is not exported.
import { OrgBanner } from "@calcom/ui/components/organization-banner";
import {
  SkeletonButton,
  SkeletonContainer,
  SkeletonText,
  SkeletonAvatar,
} from "@calcom/ui/components/skeleton";
import { showToast } from "@calcom/ui/components/toast";
import { Tooltip } from "@calcom/ui/components/tooltip";

import { useOrgBranding } from "../../../organizations/context/provider";

const orgProfileFormSchema = z.object({
  name: z.string(),
  logoUrl: z.string().nullable(),
  banner: z.string().nullable(),
  calVideoLogo: z.string().nullable(),
  bio: z.string(),
});

type FormValues = {
  id: number;
  name: string;
  logoUrl: string | null;
  banner: string | null;
  bio: string;
  slug: string;
  calVideoLogo: string | null;
};

const SkeletonLoader = () => {
  return (
    <SkeletonContainer>
      <div className="border-subtle space-y-6 rounded-b-xl border border-t-0 px-4 py-8">
        <div className="flex items-center">
          <SkeletonAvatar className="me-4 mt-0 h-16 w-16 px-4" />
          <SkeletonButton className="h-6 w-32 rounded-md p-5" />
        </div>
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />

        <SkeletonButton className="mr-6 h-8 w-20 rounded-md p-5" />
      </div>
    </SkeletonContainer>
  );
};

const OrgProfileView = ({
  permissions,
}: {
  permissions?: {
    canRead: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };
}) => {
  const { t } = useLocale();
  const router = useRouter();

  const orgBranding = useOrgBranding();

  useLayoutEffect(() => {
    document.body.focus();
  }, []);

  const {
    data: currentOrganisation,
    isPending,
    error,
  } = trpc.viewer.organizations.listCurrent.useQuery(undefined, {});

  useEffect(
    function refactorMeWithoutEffect() {
      if (error) {
        router.replace("/enterprise");
      }
    },
    [error, router]
  );

  if (isPending || !orgBranding || !currentOrganisation) {
    return <SkeletonLoader />;
  }

  const isBioEmpty =
    !currentOrganisation ||
    !currentOrganisation.bio ||
    !currentOrganisation.bio.replace("<p><br></p>", "").length;

  const defaultValues: FormValues = {
    id: currentOrganisation?.id,
    name: currentOrganisation?.name || "",
    logoUrl: currentOrganisation?.logoUrl,
    banner: currentOrganisation?.bannerUrl || "",
    bio: currentOrganisation?.bio || "",
    calVideoLogo: currentOrganisation?.calVideoLogo || "",
    slug:
      currentOrganisation?.slug ||
      ((currentOrganisation?.metadata as Prisma.JsonObject)?.requestedSlug as string) ||
      "",
  };

  return (
    <LicenseRequired>
      <>
        {permissions?.canEdit ? (
          <>
            <OrgProfileForm defaultValues={defaultValues} />
            <OrgAppearanceViewWrapper />
          </>
        ) : (
          <div className="border-subtle flex rounded-b-md border border-t-0 px-4 py-8 sm:px-6">
            <div className="flex-grow">
              <div>
                <Label className="text-emphasis">{t("organization_name")}</Label>
                <p className="text-default text-sm">{currentOrganisation?.name}</p>
              </div>
              {!isBioEmpty && (
                <>
                  <Label className="text-emphasis mt-5">{t("about")}</Label>
                  <div
                    className="  text-subtle break-words text-sm [&_a]:text-blue-500 [&_a]:underline [&_a]:hover:text-blue-600"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{
                      __html: markdownToSafeHTML(currentOrganisation.bio || ""),
                    }}
                  />
                </>
              )}
            </div>
            <div className="">
              <LinkIconButton
                Icon="link"
                onClick={() => {
                  navigator.clipboard.writeText(orgBranding.fullDomain);
                  showToast("Copied to clipboard", "success");
                }}>
                {t("copy_link_org")}
              </LinkIconButton>
            </div>
          </div>
        )}
        {/* LEAVE ORG should go above here ^ */}
      </>
    </LicenseRequired>
  );
};

const OrgProfileForm = ({ defaultValues }: { defaultValues: FormValues }) => {
  const utils = trpc.useUtils();
  const { t } = useLocale();
  const [firstRender, setFirstRender] = useState(true);

  const form = useForm({
    defaultValues,
    resolver: zodResolver(orgProfileFormSchema),
  });

  const mutation = trpc.viewer.organizations.update.useMutation({
    onError: (err) => {
      // Handle JSON parsing errors from body size limit exceeded
      if (err.message.includes("Unexpected token") && err.message.includes("Body excee")) {
        showToast(t("converted_image_size_limit_exceed"), "error");
        return;
      }
      showToast(err.message, "error");
    },
    onSuccess: async (res) => {
      reset({
        logoUrl: res.data?.logoUrl,
        name: (res.data?.name || "") as string,
        bio: (res.data?.bio || "") as string,
        slug: defaultValues["slug"],
        banner: (res.data?.bannerUrl || "") as string,
        calVideoLogo: (res.data?.calVideoLogo || "") as string,
      });
      await utils.viewer.teams.get.invalidate();
      await utils.viewer.organizations.listCurrent.invalidate();
      showToast(t("your_organization_updated_sucessfully"), "success");
    },
  });

  const {
    formState: { isSubmitting, isDirty },
    reset,
  } = form;

  const isDisabled = isSubmitting || !isDirty;

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(t("organization_id_copied"), "success");
    } catch (error) {
      showToast(t("error_copying_to_clipboard"), "error");
    }
  };
  return (
    <Form
      form={form}
      handleSubmit={(values) => {
        const variables = {
          logoUrl: values.logoUrl,
          name: values.name,
          slug: values.slug,
          bio: values.bio,
          banner: values.banner,
          calVideoLogo: values.calVideoLogo,
        };

        mutation.mutate(variables);
      }}>
      <div className="border-subtle border-x px-4 py-8 sm:px-6">
        <div className="flex items-center">
          <Controller
            control={form.control}
            name="logoUrl"
            render={({ field: { value, onChange } }) => {
              const showRemoveLogoButton = value !== null;
              return (
                <>
                  <Avatar
                    data-testid="profile-upload-logo"
                    alt={form.getValues("name")}
                    imageSrc={getPlaceholderAvatar(value, form.getValues("name"))}
                    size="lg"
                  />
                  <div className="ms-4">
                    <div className="flex gap-2">
                      <ImageUploader
                        target="logo"
                        id="avatar-upload"
                        buttonMsg={t("upload_logo")}
                        handleAvatarChange={onChange}
                        imageSrc={getPlaceholderAvatar(value, form.getValues("name"))}
                        triggerButtonColor={showRemoveLogoButton ? "secondary" : "primary"}
                      />
                      {showRemoveLogoButton && (
                        <Button color="secondary" onClick={() => onChange(null)}>
                          {t("remove")}
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              );
            }}
          />
        </div>

        <div className="my-4 flex flex-col gap-4">
          <Controller
            control={form.control}
            name="banner"
            render={({ field: { value, onChange } }) => {
              const showRemoveBannerButton = !!value;

              return (
                <>
                  <OrgBanner
                    data-testid="profile-upload-banner"
                    alt={`${defaultValues.name} Banner` || ""}
                    className="grid min-h-[150px] w-full place-items-center rounded-md sm:min-h-[200px]"
                    fallback={t("no_target", { target: "banner" })}
                    imageSrc={value}
                  />
                  <div className="ms-4">
                    <div className="flex gap-2">
                      <BannerUploader
                        height={500}
                        width={1500}
                        target="banner"
                        uploadInstruction={t("org_banner_instructions", { height: 500, width: 1500 })}
                        id="banner-upload"
                        buttonMsg={t("upload_banner")}
                        handleAvatarChange={onChange}
                        imageSrc={value || undefined}
                        triggerButtonColor={showRemoveBannerButton ? "secondary" : "primary"}
                      />
                      {showRemoveBannerButton && (
                        <Button color="destructive" onClick={() => onChange(null)}>
                          {t("remove")}
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              );
            }}
          />
        </div>
        <div className="mt-2 flex items-center">
          <Controller
            control={form.control}
            name="calVideoLogo"
            render={({ field: { value, onChange } }) => {
              const showRemoveLogoButton = !!value;
              return (
                <>
                  <Avatar
                    alt="calVideoLogo"
                    imageSrc={value}
                    fallback={<Icon name="plus" className="text-subtle h-6 w-6" />}
                    size="lg"
                  />
                  <div className="ms-4">
                    <div className="flex gap-2">
                      <ImageUploader
                        target="avatar"
                        id="cal-video-logo-upload"
                        buttonMsg={t("upload_cal_video_logo")}
                        handleAvatarChange={onChange}
                        imageSrc={value || undefined}
                        uploadInstruction={t("cal_video_logo_upload_instruction")}
                        triggerButtonColor={showRemoveLogoButton ? "secondary" : "primary"}
                        testId="cal-video-logo"
                      />
                      {showRemoveLogoButton && (
                        <Button color="secondary" onClick={() => onChange(null)}>
                          {t("remove")}
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              );
            }}
          />
        </div>

        <Controller
          control={form.control}
          name="name"
          render={({ field: { value } }) => (
            <div className="mt-8">
              <TextField
                name="name"
                label={t("organization_name")}
                value={value}
                onChange={(e) => {
                  form.setValue("name", e?.target.value, { shouldDirty: true });
                }}
              />
            </div>
          )}
        />
        <Controller
          control={form.control}
          name="slug"
          render={({ field: { value } }) => (
            <div className="mt-8">
              <TextField
                name="slug"
                label={t("organization_url")}
                value={value}
                disabled
                addOnSuffix={`.${subdomainSuffix()}`}
              />
            </div>
          )}
        />
        <Controller
          control={form.control}
          name="id"
          render={({ field: { value } }) => (
            <div className="mt-8">
              <TextField
                name="id"
                label={t("organization_id")}
                value={value}
                disabled={true}
                addOnSuffix={
                  <Tooltip content={t("copy_to_clipboard")}>
                    <Button
                      color="minimal"
                      size="sm"
                      type="button"
                      aria-label="copy organization id"
                      onClick={() => handleCopy(value.toString())}>
                      <Icon name="copy" className="ml-1 h-4 w-4" />
                    </Button>
                  </Tooltip>
                }
              />
            </div>
          )}
        />
        <div className="mt-8">
          <Label>{t("about")}</Label>
          <Editor
            getText={() => md.render(form.getValues("bio") || "")}
            setText={(value: string) => form.setValue("bio", turndown(value), { shouldDirty: true })}
            excludedToolbarItems={["blockType"]}
            disableLists
            firstRender={firstRender}
            setFirstRender={setFirstRender}
            height="80px"
          />
        </div>
        <p className="text-default mt-2 text-sm">{t("org_description")}</p>
      </div>
      <SectionBottomActions align="end">
        <Button
          data-testid="update-org-profile-button"
          color="primary"
          type="submit"
          loading={mutation.isPending}
          disabled={isDisabled}>
          {t("update")}
        </Button>
      </SectionBottomActions>
    </Form>
  );
};

export default OrgProfileView;
