import { classNames } from "@calcom/lib";

import type { HorizontalTabItemProps } from "./HorizontalTabItem";
import HorizontalTabItem from "./HorizontalTabItem";

export interface NavTabProps {
  tabs: HorizontalTabItemProps[];
  linkShallow?: boolean;
  linkScroll?: boolean;
  actions?: JSX.Element;
  className?: string;
}

const HorizontalTabs = function ({
  tabs,
  linkShallow,
  linkScroll,
  actions,
  className,
  ...props
}: NavTabProps) {
  return (
    <div className="h-9 max-w-full">
      <nav
        className={classNames(
          "no-scrollbar scrollbar-hide flex max-h-9 space-x-2 overflow-x-scroll rounded-md",
          className
        )}
        aria-label="Tabs"
        {...props}>
        {tabs.map((tab, idx) => (
          <HorizontalTabItem
            className="px-4 py-2.5"
            {...tab}
            key={idx}
            linkShallow={linkShallow}
            linkScroll={linkScroll}
          />
        ))}
      </nav>
      {actions && actions}
    </div>
  );
};

export default HorizontalTabs;
