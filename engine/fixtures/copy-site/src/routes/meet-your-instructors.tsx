import { createFileRoute } from "@tanstack/react-router";
import Instructors from "../pages/Instructors";

export const Route = createFileRoute("/meet-your-instructors")({
  component: Instructors,
});
