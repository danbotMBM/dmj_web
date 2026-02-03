package main

import "fmt"

type Route struct {
	Method string
	Path   string
	Desc   string
}

var routes []Route

func registerRoute(method, path, desc string) {
	routes = append(routes, Route{Method: method, Path: path, Desc: desc})
}

func printRoutes() {
	fmt.Println("Endpoints:")
	for _, r := range routes {
		fmt.Printf("  %-6s %-12s - %s\n", r.Method, r.Path, r.Desc)
	}
}
