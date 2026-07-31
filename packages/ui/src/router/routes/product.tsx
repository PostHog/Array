import { ProductView } from "@posthog/ui/features/product-view/ProductView";
import {
  AppPageSkeleton,
  withRouteSkeleton,
} from "@posthog/ui/router/routeSkeletons";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/product")({
  component: ProductView,
  ...withRouteSkeleton(AppPageSkeleton),
});
