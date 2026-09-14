# Shawty Kubernetes Local Validation

These manifests mirror the Docker Compose topology for local `kind` or
`minikube` validation. They are not a cloud deployment and are not wired into
CI/CD.

## Prerequisites

Install Docker Desktop, `kubectl`, and `kind`. Follow the official kind
installation instructions at <https://kind.sigs.k8s.io/docs/user/quick-start/#installation>.

## Create a cluster and load the image

```powershell
kind create cluster --name shawty
docker build -t shawty:local .
kind load docker-image shawty:local --name shawty
```

## Apply the manifests

Create the namespace first:

```powershell
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml -f k8s/secret.yaml
kubectl apply -f k8s/postgres-deployment.yaml -f k8s/postgres-service.yaml `
  -f k8s/redis-deployment.yaml -f k8s/redis-service.yaml
```

Wait for both backing pods to be running and ready before starting the app:

```powershell
kubectl wait --namespace shawty --for=condition=Ready pod `
  -l app=postgres --timeout=120s
kubectl wait --namespace shawty --for=condition=Ready pod `
  -l app=redis --timeout=120s
kubectl get pods --namespace shawty
```

Apply the app and autoscaling resources last:

```powershell
kubectl apply -f k8s/app-deployment.yaml `
  -f k8s/app-service.yaml -f k8s/hpa.yaml
kubectl wait --namespace shawty --for=condition=Available deployment/shawty `
  --timeout=180s
kubectl get pods --namespace shawty
```

## Verify health

In one terminal:

```powershell
kubectl port-forward --namespace shawty service/shawty 3000:3000
```

In another terminal:

```powershell
curl.exe http://localhost:3000/health
```

The response should report healthy Postgres and Redis dependencies.

## Teardown

Delete only the application namespace:

```powershell
kubectl delete namespace shawty
```

Or delete the entire local cluster:

```powershell
kind delete cluster --name shawty
```
