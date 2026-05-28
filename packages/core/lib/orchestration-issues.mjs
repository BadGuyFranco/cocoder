export function routePriorityIssue(route, prioritySlug) {
  if (!Array.isArray(route.supportedPriorityOwners) || route.supportedPriorityOwners.length === 0) return null;
  if (route.supportedPriorityOwners.includes('*') || route.supportedPriorityOwners.includes(prioritySlug)) return null;
  return {
    code: 'priority-owner-not-supported',
    severity: 'block',
    detail: `route ${route.id} does not list ${prioritySlug} in supportedPriorityOwners`
  };
}

export function routeGhostPriorityIssues(route, prioritySlugs) {
  if (!Array.isArray(route.supportedPriorityOwners) || route.supportedPriorityOwners.length === 0) return [];
  if (route.supportedPriorityOwners.includes('*')) return [];
  return route.supportedPriorityOwners
    .filter((slug) => !prioritySlugs.has(slug))
    .map((slug) => ({
      code: 'route-supported-priority-missing',
      severity: 'block',
      detail: `route ${route.id} lists ${slug} in supportedPriorityOwners, but ${slug} was not found in PRIORITIES.md`
    }));
}

export function blockingPriorityBoundaryIssues(priorityBoundary) {
  if (!priorityBoundary || priorityBoundary.ok) return [];
  return priorityBoundary.issues.filter((issue) => issue.code !== 'priority-boundary-missing');
}
