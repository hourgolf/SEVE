"use client";

import type { ReactNode } from "react";

export interface ChassisProps {
  brand: ReactNode; // e.g. <>SEVE<span> · CONSOLE</span></>
  sub: string;
  right?: ReactNode; // status cluster / LED / badge
  children: ReactNode;
}

// The shared cream TR-909 chassis: brand plate + sub + right slot + accent
// stripes, wrapping any view's content. Used by Console, Monitor and Desk so
// all three share one hardware design language.
export function Chassis({ brand, sub, right, children }: ChassisProps) {
  return (
    <div className="chassis">
      <div className="chassis-head">
        <div className="chassis-brand">
          <div className="mark">{brand}</div>
          <div className="sub">{sub}</div>
        </div>
        <div className="chassis-head-right">
          {right}
          <div className="stripes">
            <i className="s1" />
            <i className="s2" />
            <i className="s3" />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
