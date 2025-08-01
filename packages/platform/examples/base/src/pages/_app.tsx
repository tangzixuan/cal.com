import type { Data } from "@/pages/api/get-managed-users";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Poppins } from "next/font/google";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Select from "react-select";

import { CalProvider, BookerEmbed, Router } from "@calcom/atoms";
import "@calcom/atoms/globals.min.css";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "800"] });
type TUser = Data["users"][0];

function generateRandomEmail(name: string) {
  const localPartLength = 5;
  const domain = ["example.com", "example.net", "example.org"];

  const randomLocalPart = Array.from({ length: localPartLength }, () =>
    String.fromCharCode(Math.floor(Math.random() * 26) + 97)
  ).join("");

  const randomDomain = domain[Math.floor(Math.random() * domain.length)];

  return `${name}-${randomLocalPart}@${randomDomain}`;
}

// note(Lauris): needed because useEffect kicks in twice creating 2 parallel requests
let seeding = false;

export default function App({ Component, pageProps }: AppProps) {
  const [accessToken, setAccessToken] = useState("");
  const [email, setUserEmail] = useState("");
  const [username, setUsername] = useState("");
  const [selectedUser, setSelectedUser] = useState<TUser | null>(null);
  const [options, setOptions] = useState([]);

  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    fetch("/api/get-managed-users", {
      method: "get",
    }).then(async (res) => {
      const data = await res.json();
      setOptions(
        data.users.map((item: Data["users"][0]) => ({ ...item, value: item.id, label: item.username }))
      );
    });
  }, []);

  useEffect(() => {
    const randomEmailOne = generateRandomEmail("keith");
    const randomEmailTwo = generateRandomEmail("somay");
    const randomEmailThree = generateRandomEmail("rajiv");
    const randomEmailFour = generateRandomEmail("morgan");
    const randomEmailFive = generateRandomEmail("lauris");

    if (!seeding) {
      seeding = true;
      fetch("/api/managed-user", {
        method: "POST",

        body: JSON.stringify({
          emails: [randomEmailOne, randomEmailTwo, randomEmailThree, randomEmailFour, randomEmailFive],
        }),
      }).then(async (res) => {
        const data = await res.json();
        setAccessToken(data.accessToken);
        setUserEmail(data.email);
        setUsername(data.username);
      });
    }
  }, []);
  useEffect(() => {
    if (!!selectedUser) {
      setAccessToken(selectedUser.accessToken);
      setUserEmail(selectedUser.email);
      setUsername(selectedUser.username);
    }
  }, [selectedUser]);

  return (
    <div className={`${poppins.className} text-black`}>
      {options.length > 0 && (
        <Select defaultValue={selectedUser} onChange={setSelectedUser} options={options} />
      )}
      <CalProvider
        accessToken={accessToken}
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        clientId={process.env.NEXT_PUBLIC_X_CAL_ID ?? ""}
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        options={{ apiUrl: process.env.NEXT_PUBLIC_CALCOM_API_URL ?? "", refreshUrl: "/api/refresh" }}>
        {email ? (
          <>
            <Component {...pageProps} calUsername={username} calEmail={email} />
          </>
        ) : (
          <>
            <main className={`flex min-h-screen flex-col items-center justify-between p-24 `}>
              <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex" />
            </main>
          </>
        )}
      </CalProvider>{" "}
      {pathname === "/embed" && (
        <div>
          <BookerEmbed
            customClassNames={{
              bookerContainer: "!bg-[#F5F2FE] [&_button:!rounded-full] border-subtle border",
              datePickerCustomClassNames: {
                datePickerDatesActive: "!bg-[#D7CEF5]",
              },
              eventMetaCustomClassNames: {
                eventMetaTitle: "text-[#7151DC]",
              },
              availableTimeSlotsCustomClassNames: {
                availableTimeSlotsHeaderContainer: "!bg-[#F5F2FE]",
                availableTimes: "!bg-[#D7CEF5]",
              },
            }}
            username={username}
            eventSlug="thirty-minutes"
            onCreateBookingSuccess={(data) => {
              router.push(`/${data.data.uid}`);
            }}
          />
        </div>
      )}
      {pathname === "/router" && (
        <div className="p-4">
          <Router
            formId="a63e6fce-899a-404e-8c38-e069710589c5"
            formResponsesURLParams={new URLSearchParams({ isBookingDryRun: "true", Territory: "Europe" })}
            onDisplayBookerEmbed={() => {
              console.log("render booker embed");
            }}
            bannerUrl="https://i0.wp.com/mahala.co.uk/wp-content/uploads/2014/12/img_banner-thin_mountains.jpg?fit=800%2C258&ssl=1"
            bookerCustomClassNames={{
              bookerWrapper: "dark",
            }}
          />
        </div>
      )}
    </div>
  );
}
