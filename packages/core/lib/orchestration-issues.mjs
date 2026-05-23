export function routePriorityIssue(route, prioritySlug) {
  if (!Array.isArray(route.supportedPriorityOwners) || route.supportedPriorityOwners.length === 0) return null;
  if (route.supportedPriorityOwners.includes('*') || route.supportedPriorityOwners.includes(prioritySlug)) return null;
  return {
    code: 'priority-owner-not-supported',
    severity: 'block',
    detail: `route ${route.id} does not list ${prioritySlug} in supportedPriorityOwners`
  };
}

export function blockingPriorityBoundaryIssues(priorityBoundary) {
  if (!priorityBoundary || priorityBoundary.ok) return [];
  return priorityBoundary.issues.filter((issue) => issue.code !== 'priority-boundary-missing');
}
