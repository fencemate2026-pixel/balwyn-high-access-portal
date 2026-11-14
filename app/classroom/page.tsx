import type { Metadata } from "next";
import ClassroomScreen from "./classroom-screen";

export const metadata: Metadata = {
  title: "Classroom screen | Magic Keys",
  description: "The route shown on classroom projectors during a fire evacuation.",
};

export default function ClassroomPage() {
  return <ClassroomScreen />;
}
